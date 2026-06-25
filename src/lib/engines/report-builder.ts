import type { SupabaseClient } from "@supabase/supabase-js";
import { generateReportHTML, type ReportData } from "@/lib/engines/report-generator";
import { generateReportPDF } from "@/lib/engines/report-pdf";
import { calculateAdsEquivalent } from "@/lib/engines/ads-equivalent";
import { getRealKeywordCpc } from "@/lib/providers/dataforseo";
import type { RoadmapItem, VisibilityResult } from "@/types/database";

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

  let realCpc: number | null = null;
  if (attribution) {
    const { data: kwRows } = await supabase
      .from("keywords")
      .select("keyword")
      .eq("project_id", projectId)
      .limit(50);
    const kwList = (kwRows || []).map((k) => k.keyword).filter(Boolean);
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
    generatedAt: new Date().toISOString(),
    adsEquivalent: adsEquivalent
      ? {
          totalOrganicValue: adsEquivalent.totalOrganicValue,
          replacementRatio: adsEquivalent.replacementRatio,
          statedAdSpend: adsEquivalent.statedAdSpend,
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
  const html = generateReportHTML(reportData, whiteLabel);
  const htmlFileName = `reports/${projectId}/${reportId}.html`;
  const pdfFileName = `reports/${projectId}/${reportId}.pdf`;

  let publicUrl: string | null = null;

  try {
    const pdfBuffer = await generateReportPDF(reportData, whiteLabel);
    await supabase.storage.from("reports").upload(pdfFileName, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });
    const { data: pdfUrlData } = supabase.storage.from("reports").getPublicUrl(pdfFileName);
    publicUrl = pdfUrlData.publicUrl;
  } catch {
    // PDF optional
  }

  try {
    await supabase.storage.from("reports").upload(htmlFileName, html, {
      contentType: "text/html",
      upsert: true,
    });
    const { data: urlData } = supabase.storage.from("reports").getPublicUrl(htmlFileName);
    publicUrl = publicUrl || urlData.publicUrl;
  } catch {
    publicUrl = publicUrl || `data:text/html;base64,${Buffer.from(html).toString("base64")}`;
  }

  await supabase.from("reports").update({ pdf_url: publicUrl, white_label: !!whiteLabel }).eq("id", reportId);
  return publicUrl;
}
