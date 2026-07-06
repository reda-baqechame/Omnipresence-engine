import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import {
  gatherReportData,
  saveReportArtifacts,
  saveIntelligenceReportArtifacts,
} from "@/lib/engines/report-builder";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { canUseDeepReport } from "@/lib/plans/features";
import { apiForbidden, apiServerError, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { guardOrgEndpoint } from "@/lib/security/api-v1-guard";
import type { SubscriptionPlan } from "@/types/database";
import type { IntelligenceReportSectionId } from "@/types/intelligence-report";
import { getReportPreset } from "@/lib/engines/report-presets";
import { ReportGenerateSchema } from "@/lib/validation/schemas";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const access = await verifyProjectAccess(supabase, id, user.id, "member");
  if (!access) return apiForbidden();

  const limited = await guardOrgEndpoint(access.organizationId, "report-generate", 15, 60 * 60 * 1000);
  if (limited) return limited;

  let reportType: "standard" | "deep" = "standard";
  let sections: IntelligenceReportSectionId[] | undefined;

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const parsed = await validateBody(request, ReportGenerateSchema);
    if (parsed.response) return parsed.response;
    const body = parsed.data;
    if (body.preset) {
      const preset = getReportPreset(body.preset);
      if (preset) {
        reportType = preset.reportType;
        sections = preset.sections.length ? preset.sections : undefined;
      }
    } else {
      reportType = body.report_type === "deep" ? "deep" : "standard";
      sections = body.sections as IntelligenceReportSectionId[] | undefined;
    }
  }

  if (reportType === "deep") {
    const { data: project } = await supabase.from("projects").select("organization_id").eq("id", id).single();
    const { data: org } = project
      ? await supabase.from("organizations").select("plan").eq("id", project.organization_id).single()
      : { data: null };
    if (!canUseDeepReport(org?.plan as SubscriptionPlan)) {
      return NextResponse.json(
        { error: "Deep Intelligence Reports require Tracking plan or above." },
        { status: 403 }
      );
    }
  }

  const title =
    reportType === "deep"
      ? `Deep Intelligence Report — ${new Date().toLocaleDateString()}`
      : `OmniPresence Report — ${new Date().toLocaleDateString()}`;

  const { data: report, error: reportError } = await supabase
    .from("reports")
    .insert({
      project_id: id,
      title,
      is_public: true,
      report_type: reportType,
      sections: sections || [],
      status: reportType === "deep" ? "pending" : "generating",
    })
    .select()
    .single();

  if (reportError || !report) return apiServerError("report create failed", reportError);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const reportUrl = `${appUrl}/report/${report.share_token}`;

  const useInngest = Boolean(process.env.INNGEST_EVENT_KEY) || reportType === "deep";

  if (useInngest) {
    await inngest.send({
      name: "project/report.generate",
      data: { projectId: id, reportId: report.id, reportType },
    });
    return NextResponse.json({ url: reportUrl, status: "generating", token: report.share_token });
  }

  const service = await createServiceClient();
  try {
    if (reportType === "deep") {
      await saveIntelligenceReportArtifacts(service, id, report.id, "");
    } else {
      const gathered = await gatherReportData(service, id);
      if (gathered) {
        await saveReportArtifacts(service, id, report.id, gathered.reportData, gathered.whiteLabel);
      }
    }
  } catch (err) {
    return apiServerError("report generation failed", err);
  }

  return NextResponse.json({ url: reportUrl, status: "ready", token: report.share_token });
}
