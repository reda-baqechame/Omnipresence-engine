import type { SupabaseClient } from "@supabase/supabase-js";
import { generateReportHTML, type ReportData } from "@/lib/engines/report-generator";
import { generateReportPDF } from "@/lib/engines/report-pdf";
import { calculateAdsEquivalent } from "@/lib/engines/ads-equivalent";
import { getRealKeywordCpc } from "@/lib/providers/dataforseo";
import { buildProofReport, renderProofHTML } from "@/lib/engines/proof-report";
import { canUseWhiteLabel } from "@/lib/plans/features";
import { withJobContext } from "@/lib/observability/job-context";
import type { RoadmapItem, SubscriptionPlan, VisibilityResult } from "@/types/database";
import type { IntelligenceReportSectionId } from "@/types/intelligence-report";

export interface WhiteLabelBranding {
  name: string;
  color: string;
}

export async function getOrgWhiteLabel(
  supabase: SupabaseClient,
  organizationId: string
): Promise<WhiteLabelBranding | undefined> {
  const { data: org } = await supabase
    .from("organizations")
    .select("white_label_name, white_label_primary_color, plan")
    .eq("id", organizationId)
    .single();

  if (!org?.white_label_name) {
    return undefined;
  }

  // White-label is an agency/enterprise capability (or open under FREE_ACCESS_MODE).
  if (!canUseWhiteLabel(org.plan as SubscriptionPlan)) {
    return undefined;
  }

  return {
    name: org?.white_label_name || "PresenceOS",
    color: org?.white_label_primary_color || "#6366f1",
  };
}

export async function gatherReportData(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ reportData: ReportData; whiteLabel?: WhiteLabelBranding } | null> {
  const { data: project } = await supabase.from("projects").select("*").eq("id", projectId).single();
  if (!project) return null;

  const [
    { data: scores },
    { data: findings },
    { data: coverage },
    { data: authority },
    { data: roadmap },
    { data: visibility },
    { data: attribution },
  ] = await Promise.all([
    supabase.from("scores").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(2),
    supabase.from("technical_findings").select("*").eq("project_id", projectId),
    supabase.from("coverage_items").select("*").eq("project_id", projectId),
    supabase.from("authority_opportunities").select("*").eq("project_id", projectId).limit(10),
    supabase.from("roadmaps").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).single(),
    supabase.from("visibility_results").select("*").eq("project_id", projectId),
    supabase
      .from("attribution_metrics")
      .select("organic_traffic, ai_referral_traffic, paid_ads_equivalent")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!scores?.[0]) return null;

  const whiteLabel = await getOrgWhiteLabel(supabase, project.organization_id);

  // Fast-upside ("striking distance") keywords: already ranking 4-20, where a
  // small push typically yields the biggest, fastest traffic gain. Real rank data.
  const { data: striking } = await supabase
    .from("rank_keywords")
    .select("keyword, last_position, target_url")
    .eq("project_id", projectId)
    .gte("last_position", 4)
    .lte("last_position", 20)
    .order("last_position", { ascending: true })
    .limit(10);

  const proof = await buildProofReport(supabase, projectId).catch(() => null);
  const proofHtml = proof ? renderProofHTML(proof, whiteLabel?.color) : undefined;

  let realCpc: number | null = null;
  if (attribution) {
    // Keyword inventory for real-CPC lookup: scan-discovered opportunities are
    // the broadest source; fall back to the user's tracked rank keywords.
    const { data: oppRows } = await supabase
      .from("keyword_opportunities")
      .select("keyword")
      .eq("project_id", projectId)
      .limit(50);
    let kwList = (oppRows || []).map((k) => k.keyword).filter(Boolean);
    if (!kwList.length) {
      const { data: rankRows } = await supabase
        .from("rank_keywords")
        .select("keyword")
        .eq("project_id", projectId)
        .limit(50);
      kwList = (rankRows || []).map((k) => k.keyword).filter(Boolean);
    }
    if (kwList.length) realCpc = await getRealKeywordCpc(kwList);
  }

  const adsEquivalent = attribution
    ? calculateAdsEquivalent({
        organicSessions: attribution.organic_traffic ?? 0,
        aiReferralSessions: attribution.ai_referral_traffic ?? 0,
        monthlyAdSpend: project.monthly_ad_spend ?? 0,
        industry: project.industry,
        customCpc: realCpc ?? undefined,
      })
    : undefined;

  const reportData: ReportData = {
    project,
    score: scores[0],
    previousScore: scores[1],
    technicalFindings: findings || [],
    coverageItems: coverage || [],
    authorityOpportunities: authority || [],
    roadmapItems: (roadmap?.items || []) as RoadmapItem[],
    visibilityResults: (visibility || []) as VisibilityResult[],
    strikingKeywords: (striking || []).map((k) => ({
      keyword: k.keyword as string,
      position: k.last_position as number,
      url: (k.target_url as string) || undefined,
    })),
    generatedAt: new Date().toISOString(),
    proofHtml,
    adsEquivalent: adsEquivalent
      ? {
          totalOrganicValue: adsEquivalent.totalOrganicValue,
          replacementRatio: adsEquivalent.replacementRatio,
          statedAdSpend: adsEquivalent.statedAdSpend,
          cpcSource: adsEquivalent.cpcSource,
        }
      : undefined,
  };

  return { reportData, whiteLabel };
}

export async function saveReportArtifacts(
  supabase: SupabaseClient,
  projectId: string,
  reportId: string,
  reportData: ReportData,
  whiteLabel?: WhiteLabelBranding
): Promise<string> {
  return withJobContext({ reportId }, async () => {
    const html = generateReportHTML(reportData, whiteLabel);
    const htmlFileName = `reports/${projectId}/${reportId}.html`;
    const pdfFileName = `reports/${projectId}/${reportId}.pdf`;

    let pdfStoragePath: string | null = null;
    let htmlStoragePath: string | null = null;

    try {
      const pdfBuffer = await generateReportPDF(reportData, whiteLabel);
      const { error: uploadError } = await supabase.storage
        .from("reports")
        .upload(pdfFileName, pdfBuffer, { contentType: "application/pdf", upsert: true });
      if (!uploadError) pdfStoragePath = pdfFileName;
    } catch {
      // PDF optional — degraded state recorded below
    }

    try {
      const { error: uploadError } = await supabase.storage
        .from("reports")
        .upload(htmlFileName, html, { contentType: "text/html", upsert: true });
      if (!uploadError) htmlStoragePath = htmlFileName;
    } catch {
      // HTML upload failed — the report row still records `ready`; the download
      // route falls back to regenerating HTML on demand from live project data.
    }

    await supabase
      .from("reports")
      .update({
        pdf_storage_path: pdfStoragePath,
        html_storage_path: htmlStoragePath,
        pdf_degraded: !pdfStoragePath,
        white_label: !!whiteLabel,
        status: "ready",
      })
      .eq("id", reportId);

    return pdfStoragePath || htmlStoragePath || "";
  });
}

export async function saveIntelligenceReportArtifacts(
  supabase: SupabaseClient,
  projectId: string,
  reportId: string,
  organizationId: string
): Promise<string> {
  return withJobContext({ reportId }, async () => {
    const { gatherIntelligenceReport } = await import("@/lib/engines/intelligence-report-builder");
    const { generateIntelligenceReportHTML } = await import("@/lib/engines/intelligence-report-template");
    const { generateReportNarrative } = await import("@/lib/engines/intelligence-report-narrative");
    const { renderReportPdf } = await import("@/lib/providers/ai-ui-capture");

    const { data: reportRow } = await supabase
      .from("reports")
      .select("sections")
      .eq("id", reportId)
      .single();
    const sections = (reportRow?.sections as IntelligenceReportSectionId[] | null) || undefined;

    const gathered = await gatherIntelligenceReport(supabase, projectId, { sections });
    if (!gathered) throw new Error("No intelligence report data");

    const narrative = await generateReportNarrative(gathered.report, { useLlm: true });
    const html = generateIntelligenceReportHTML(gathered.report, gathered.branding, narrative);
    const htmlFileName = `reports/${projectId}/${reportId}.html`;
    const pdfFileName = `reports/${projectId}/${reportId}.pdf`;

    let pdfStoragePath: string | null = null;
    let htmlStoragePath: string | null = null;

    const pdfBuffer = await renderReportPdf(html);
    if (pdfBuffer) {
      const { error: uploadError } = await supabase.storage
        .from("reports")
        .upload(pdfFileName, pdfBuffer, { contentType: "application/pdf", upsert: true });
      if (!uploadError) pdfStoragePath = pdfFileName;
    }

    try {
      const { error: uploadError } = await supabase.storage
        .from("reports")
        .upload(htmlFileName, html, { contentType: "text/html", upsert: true });
      if (!uploadError) htmlStoragePath = htmlFileName;
    } catch {
      // HTML upload failed — download route falls back to on-demand HTML render.
    }

    await supabase.from("reports").update({
      pdf_storage_path: pdfStoragePath,
      html_storage_path: htmlStoragePath,
      // Deep PDF rendering depends on the external ai-ui-capture Playwright
      // service (ENABLE_AI_UI_CAPTURE + AI_UI_CAPTURE_URL). When it's not
      // configured or fails, renderReportPdf returns null and the user must be
      // told the download will be HTML, not silently handed an .html file
      // dressed up as a PDF download.
      pdf_degraded: !pdfStoragePath,
      white_label: !!gathered.branding,
      status: "ready",
      error_message: null,
    }).eq("id", reportId);

    return pdfStoragePath || htmlStoragePath || "";
  });
}

/** Render HTML for a report row (standard or deep intelligence). */
export async function renderReportHtmlForView(
  supabase: SupabaseClient,
  projectId: string,
  reportType: "standard" | "deep" = "standard",
  sections?: IntelligenceReportSectionId[]
): Promise<string | null> {
  if (reportType === "deep") {
    const { gatherIntelligenceReport } = await import("@/lib/engines/intelligence-report-builder");
    const { generateIntelligenceReportHTML } = await import("@/lib/engines/intelligence-report-template");
    const { generateReportNarrative } = await import("@/lib/engines/intelligence-report-narrative");
    const gathered = await gatherIntelligenceReport(supabase, projectId, { sections });
    if (!gathered) return null;
    const narrative = await generateReportNarrative(gathered.report, { useLlm: false });
    return generateIntelligenceReportHTML(gathered.report, gathered.branding, narrative);
  }

  const gathered = await gatherReportData(supabase, projectId);
  if (!gathered) return null;
  return generateReportHTML(gathered.reportData, gathered.whiteLabel);
}
