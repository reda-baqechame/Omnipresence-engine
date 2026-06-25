import { NextRequest, NextResponse } from "next/server";
import { runTechnicalAudit } from "@/lib/engines/technical-audit";
import { calculateOmniPresenceScore } from "@/lib/scoring/omnipresence";
import { createServiceClient } from "@/lib/supabase/server";
import { sendAuditLeadEmail } from "@/lib/email/reports";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { guardPublicEndpoint, isValidEmail } from "@/lib/security/public-guard";
import { apiError } from "@/lib/security/api-response";
import {
  runPublicAuditIntelligence,
  mergeIntelligenceIntoScore,
} from "@/lib/engines/public-audit-scan";
import { preferLiveData } from "@/lib/config/capabilities";

export async function POST(request: NextRequest) {
  const limited = guardPublicEndpoint(request, "public-audit", 5, 60 * 60 * 1000);
  if (limited) return limited;

  const { domain, brandName, industry, email, location, competitors } = await request.json();

  if (!domain || !email) {
    return apiError("Domain and email required");
  }

  if (!isValidEmail(email)) {
    return apiError("Invalid email address");
  }

  let normalized: string;
  try {
    normalized = assertPublicDomain(domain);
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

  const [technicalFindings, intelligence] = await Promise.all([
    runTechnicalAudit(normalized),
    runPublicAuditIntelligence({
      domain: normalized,
      brandName: name,
      industry: ind,
      location: loc,
      competitors: compList,
    }),
  ]);

  const baseScore = calculateOmniPresenceScore({
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
    coverageItems: [],
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
  });

  const score = mergeIntelligenceIntoScore(technicalFindings, intelligence, {
    omnipresence_score: baseScore.omnipresence_score,
    ai_visibility: baseScore.ai_visibility,
    search_visibility: baseScore.search_visibility,
    technical_readiness: baseScore.technical_readiness,
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
    backlinkCount: intelligence.backlinkCount,
    serpPresence: intelligence.serpPresence,
    liveData: intelligence.liveData,
    dataMode: intelligence.dataMode,
    providersConfigured: intelligence.providers.configuredCount,
    message: intelligence.liveData
      ? "Live audit with real SERP/AI visibility data. Sign up for full competitor tracking and 90-day execution roadmap."
      : "Technical audit is live. Add API keys (Serper + OpenAI minimum) for full AI visibility measurement.",
  });
}
