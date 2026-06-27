import { createServiceClient } from "@/lib/supabase/server";
import { gatherReportData, getOrgWhiteLabel } from "@/lib/engines/report-builder";
import { generateReportHTML } from "@/lib/engines/report-generator";
import { notFound } from "next/navigation";

/**
 * White-label client portal — the branded, client-facing view of a project's
 * proof + report, reachable via a share token (and, for agencies, a custom
 * domain pointed at this route). Always applies the agency's branding when the
 * plan allows; never exposes the platform's own marks to the client.
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
    .select("project_id, is_public")
    .eq("share_token", token)
    .single();

  if (!report || !report.is_public) notFound();

  const gathered = await gatherReportData(supabase, report.project_id);
  if (!gathered) notFound();

  // For the portal, fall back to neutral branding if no white-label is set, so
  // the platform name is never shown to an agency's client.
  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", report.project_id)
    .single();
  const whiteLabel =
    gathered.whiteLabel ||
    (project ? await getOrgWhiteLabel(supabase, project.organization_id) : undefined) ||
    { name: "Client Report", color: "#6366f1" };

  const html = generateReportHTML(gathered.reportData, whiteLabel);

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
