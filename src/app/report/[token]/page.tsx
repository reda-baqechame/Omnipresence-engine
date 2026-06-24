import { createServiceClient } from "@/lib/supabase/server";
import { gatherReportData } from "@/lib/engines/report-builder";
import { generateReportHTML } from "@/lib/engines/report-generator";
import { notFound } from "next/navigation";

export default async function PublicReportPage({
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

  const html = generateReportHTML(gathered.reportData, gathered.whiteLabel);

  return (
    <div>
      <div className="fixed top-4 right-4 z-50 flex gap-2">
        <a
          href={`/api/report/${token}/pdf`}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg hover:bg-indigo-700"
        >
          Download PDF
        </a>
      </div>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
