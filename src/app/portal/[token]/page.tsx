import { createServiceClient } from "@/lib/supabase/server";
import { renderReportHtmlForView, getOrgWhiteLabel } from "@/lib/engines/report-builder";
import { notFound } from "next/navigation";

/**
 * White-label client portal — the branded, client-facing view of a project's
 * proof + report, reachable via a share token (and, for agencies, a custom
 * domain pointed at this route).
 */
export default async function ClientPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createServiceClient();

  const { data: report } = await supabase
    .from("reports")
    .select("project_id, is_public, report_type, status, error_message, title")
    .eq("share_token", token)
    .single();

  if (!report || !report.is_public) notFound();

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", report.project_id)
    .single();

  if (project) {
    const { data: org } = await supabase
      .from("organizations")
      .select("client_portal_enabled, plan, white_label_name")
      .eq("id", project.organization_id)
      .single();

    if (org?.client_portal_enabled === false) {
      notFound();
    }
  }

  if (report.status === "generating" || report.status === "pending") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        <h1 className="text-xl font-semibold">Preparing client report</h1>
        <meta httpEquiv="refresh" content="15" />
      </div>
    );
  }

  if (report.status === "failed") notFound();

  const html = await renderReportHtmlForView(
    supabase,
    report.project_id,
    (report.report_type as "standard" | "deep") || "standard"
  );
  if (!html) notFound();

  const whiteLabel =
    (project ? await getOrgWhiteLabel(supabase, project.organization_id) : undefined) ||
    { name: "Client Report", color: "#6366f1" };

  void whiteLabel;

  return (
    <div>
      <div className="fixed top-4 right-4 z-50 flex gap-2">
        <a
          href={`/api/report/${token}/pdf`}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-indigo-700"
        >
          Download PDF
        </a>
      </div>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
