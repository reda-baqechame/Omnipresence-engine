import { NextRequest, NextResponse } from "next/server";
import { runTechnicalAudit } from "@/lib/engines/technical-audit";
import { calculateOmniPresenceScore } from "@/lib/scoring/omnipresence";
import { createServiceClient } from "@/lib/supabase/server";
import { sendAuditLeadEmail } from "@/lib/email/reports";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { guardPublicEndpoint, isValidEmail } from "@/lib/security/public-guard";
import { apiError } from "@/lib/security/api-response";
import {
  generateDemoPrompts,
  generateDemoVisibilityResults,
  generateDemoAuthorityOpportunities,
} from "@/lib/demo/scan-data";

export async function POST(request: NextRequest) {
  const limited = guardPublicEndpoint(request, "public-audit", 5, 60 * 60 * 1000);
  if (limited) return limited;

  const { domain, brandName, industry, email } = await request.json();

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

  const technicalFindings = await runTechnicalAudit(normalized);

  const demoPrompts = generateDemoPrompts("preview", name, ind, "", []);
  const visibilityResults = generateDemoVisibilityResults(
    "preview",
    "preview-run",
    name,
    normalized,
    [],
    demoPrompts.map((p) => ({ text: p.text }))
  );

  const authorityOpportunities = generateDemoAuthorityOpportunities("preview", ind, []);

  const score = calculateOmniPresenceScore({
    visibilityResults: visibilityResults.map((r, i) => ({
      ...r,
      id: `preview-${i}`,
      created_at: new Date().toISOString(),
    })) as import("@/types/database").VisibilityResult[],
    technicalFindings: technicalFindings.map((f) => ({
      ...f,
      project_id: "preview",
      is_resolved: false,
      id: "",
      created_at: "",
    })),
    coverageItems: [],
    authorityOpportunities: authorityOpportunities as import("@/types/database").AuthorityOpportunity[],
    hasConversionTracking: false,
    hasGbp: false,
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
  };

  try {
    const supabase = await createServiceClient();
    await supabase.from("audit_leads").insert({
      email: email.toLowerCase().slice(0, 254),
      domain: normalized,
      brand_name: name,
      industry: ind,
      score_snapshot: scoreSnapshot,
      source: "public_audit",
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
    authorityOpportunities: authorityOpportunities.slice(0, 5),
    message: "Sign up for the full audit with competitor analysis, 90-day roadmap, and white-label PDF.",
  });
}
