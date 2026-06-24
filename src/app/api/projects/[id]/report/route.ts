import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { gatherReportData, saveReportArtifacts } from "@/lib/engines/report-builder";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiForbidden, apiServerError, apiUnauthorized } from "@/lib/security/api-response";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const access = await verifyProjectAccess(supabase, id, user.id, "member");
  if (!access) return apiForbidden();

  const { data: report, error: reportError } = await supabase
    .from("reports")
    .insert({
      project_id: id,
      title: `OmniPresence Report — ${new Date().toLocaleDateString()}`,
      is_public: true,
    })
    .select()
    .single();

  if (reportError || !report) return apiServerError("report create failed", reportError);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (process.env.INNGEST_EVENT_KEY) {
    await inngest.send({
      name: "project/report.generate",
      data: { projectId: id, reportId: report.id },
    });
  } else {
    const service = await createServiceClient();
    const gathered = await gatherReportData(service, id);
    if (gathered) {
      await saveReportArtifacts(service, id, report.id, gathered.reportData, gathered.whiteLabel);
    }
  }

  return NextResponse.redirect(`${appUrl}/report/${report.share_token}`);
}
