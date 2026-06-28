import { NextRequest, NextResponse } from "next/server";
import { runTechnicalAudit } from "@/lib/engines/technical-audit";
import { calculateOmniPresenceScore } from "@/lib/scoring/omnipresence";
import { getAuthorityRating } from "@/lib/engines/authority-rating";
import { getPageSpeed, pageSpeedToRetrievalScore } from "@/lib/providers/pagespeed";
import { createServiceClient } from "@/lib/supabase/server";
import { sendAuditLeadEmail } from "@/lib/email/reports";
import { assertPublicDomain, assertDomainResolvesPublic, DomainValidationError } from "@/lib/security/domain";
import { guardPublicEndpoint, isValidEmail } from "@/lib/security/public-guard";
import { apiError, readJsonBody } from "@/lib/security/api-response";
import { runPublicAuditIntelligence } from "@/lib/engines/public-audit-scan";
import { preferLiveData } from "@/lib/config/capabilities";

export async function POST(request: NextRequest) {
  const limited = guardPublicEndpoint(request, "public-audit", 5, 60 * 60 * 1000);
  if (limited) return limited;

  let body: { domain?: string; brandName?: string; industry?: string; email?: string; location?: string; competitors?: string[] };
  try {
    body = await readJsonBody(request);
  } catch {
    return apiError("Invalid JSON body");
  }
  const { domain, brandName, industry, email, location, competitors } = body;

  if (!domain || !email) {
    return apiError("Domain and email required");
  }

  if (!isValidEmail(email)) {
    return apiError("Invalid email address");
  }

  let normalized: string;
  try {
    normalized = assertPublicDomain(domain);
    // SSRF guard: reject hostnames that resolve to private/internal IPs before
    // we fetch them (unauthenticated entry point).
    await assertDomainResolvesPublic(normalized);
  } catch (error) {
    if (error instanceof DomainValidationError) return apiError(error.message);
    return apiError("Invalid domain");
  }

  const name = brandName ? String(brandName).slice(0, 120) : normalized.split(".")[0];
  const ind = industry ? String(industry).slice(0, 80) : "business";
  const loc = location ? String(location).slice(0, 80) : "";
  const compList = Array.isArray(competitors)
    ? competitors.map((c: string) => String(c).slice(0, 80)).slice(0, 5)
    : [];

  // Same keyless authority + retrieval-health signals the authenticated scan
  // feeds into the score, so the public number is computed identically.
  const [technicalFindings, intelligence, authority, pageSpeed] = await Promise.all([
    runTechnicalAudit(normalized),
    runPublicAuditIntelligence({
      domain: normalized,
      brandName: name,
      industry: ind,
      location: loc,
      competitors: compList,
    }),
    getAuthorityRating(normalized).catch(() => null),
    getPageSpeed(normalized, "mobile").catch(() => null),
  ]);

  const domainAuthority = authority && authority.rating > 0 ? authority.rating : undefined;
  const pageSpeedScore =
    pageSpeed?.success && pageSpeed.data ? pageSpeedToRetrievalScore(pageSpeed.data) : undefined;

  // Use the SAME rigorous, measured-only scorer as the authenticated product so
  // the public lead-gen number matches what the user sees after signing up.
  // (Previously an ad-hoc booster re-added mention/citation/SERP signals that the
  // base scorer already accounts for, double-counting and inflating the score.)
  const score = calculateOmniPresenceScore({
    visibilityResults: intelligence.visibilityResults.map((r, i) => ({
      ...r,
      id: `public-${i}`,
      run_id: "public",
      project_id: "public",
      prompt_id: undefined,
      competitor_mentions: {},
      competitor_citations: {},
      cited_urls: [],
      created_at: new Date().toISOString(),
    })) as unknown as import("@/types/database").VisibilityResult[],
    technicalFindings: technicalFindings.map((f) => ({
      ...f,
      project_id: "public",
      is_resolved: false,
      id: "",
      created_at: "",
    })),
    coverageItems: intelligence.coverageItems.map((c, i) => ({
      id: `pub-cov-${i}`,
      project_id: "public",
      surface: c.surface as import("@/types/database").CoverageSurface,
      platform_name: c.platform_name,
      profile_url: undefined,
      is_present: c.is_present,
      is_optimized: false,
      competitor_present: c.competitor_present,
      notes: undefined,
      data_quality: "measured" as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })) as unknown as import("@/types/database").CoverageItem[],
    authorityOpportunities: intelligence.authorityOpportunities.map((o, i) => ({
      id: `pub-${i}`,
      project_id: "public",
      type: o.type as import("@/types/database").AuthorityType,
      target_site: o.target_site,
      pitch_angle: o.pitch_angle,
      estimated_impact: o.estimated_impact,
      difficulty_score: 50,
      competitor_present: false,
      status: "identified",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    hasConversionTracking: false,
    hasGbp: false,
    domainAuthority,
    pageSpeedScore,
  });

  const criticalCount = technicalFindings.filter(
    (f) => f.severity === "critical" || f.severity === "high"
  ).length;

  const scoreSnapshot = {
    omnipresence: score.omnipresence_score,
    ai_visibility: score.ai_visibility,
    search_visibility: score.search_visibility,
    technical_readiness: score.technical_readiness,
    critical_issues: criticalCount,
    data_mode: intelligence.dataMode,
    measured_rate: intelligence.visibilityMetrics.measuredRate,
  };

  try {
    const supabase = await createServiceClient();
    await supabase.from("audit_leads").insert({
      email: email.toLowerCase().slice(0, 254),
      domain: normalized,
      brand_name: name,
      industry: ind,
      score_snapshot: scoreSnapshot,
      source: preferLiveData() ? "public_audit_live" : "public_audit",
    });
  } catch {
    // Lead persistence is best-effort when DB isn't configured
  }

  sendAuditLeadEmail(email, normalized, score.omnipresence_score).catch(() => {});

  return NextResponse.json({
    domain: normalized,
    email,
    score: scoreSnapshot,
    criticalIssues: criticalCount,
    topIssues: technicalFindings
      .filter((f) => f.severity === "critical" || f.severity === "high")
      .slice(0, 5),
    visibility: {
      mentionRate: intelligence.visibilityMetrics.mentionRate,
      citationRate: intelligence.visibilityMetrics.citationRate,
      measuredRate: intelligence.visibilityMetrics.measuredRate,
      sample: intelligence.visibilityResults.slice(0, 5),
    },
    authorityOpportunities: intelligence.authorityOpportunities.slice(0, 5),
    coverageGaps: intelligence.coverageGaps,
    coverageItems: intelligence.coverageItems,
    competitorGaps: intelligence.coverageItems.filter((c) => !c.is_present && c.competitor_present).length,
    backlinkCount: intelligence.backlinksAvailable ? intelligence.backlinkCount : null,
    backlinksAvailable: intelligence.backlinksAvailable,
    serpPresence: intelligence.serpPresence,
    authority: authority
      ? {
          rating: authority.rating,
          referringDomains: authority.components.referringDomains,
          domainAgeYears: authority.components.ageYears,
          sources: authority.sources,
        }
      : null,
    liveData: intelligence.liveData,
    dataMode: intelligence.dataMode,
    providersConfigured: intelligence.providers.configuredCount,
    message: intelligence.liveData
      ? "Live audit with real SERP/AI visibility data. Sign up for full competitor tracking and 90-day execution roadmap."
      : "Technical audit is live. Add API keys (Serper + OpenAI minimum) for full AI visibility measurement.",
  });
}
