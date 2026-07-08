import { createServiceClient } from "@/lib/supabase/server";
import { renderReportHtmlForView } from "@/lib/engines/report-builder";
import { notFound } from "next/navigation";
import type { IntelligenceReportSectionId } from "@/types/intelligence-report";

export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createServiceClient();

  const { data: report } = await supabase
    .from("reports")
    .select("project_id, is_public, report_type, status, error_message, title, sections")
    .eq("share_token", token)
    .single();

  if (!report || !report.is_public) notFound();

  if (report.status === "generating" || report.status === "pending") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        <h1 className="text-xl font-semibold">Generating {report.title}</h1>
        <p className="text-muted-foreground text-center max-w-md">
          {report.report_type === "deep"
            ? "Deep Intelligence Reports aggregate every engine — this may take 1–3 minutes. Refresh shortly."
            : "Your report is being prepared. Refresh in a moment."}
        </p>
        <meta httpEquiv="refresh" content="15" />
      </div>
    );
  }

  if (report.status === "cancelling") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
        <h1 className="text-xl font-semibold">Stopping {report.title}</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Cancellation requested — generation will halt before its next step. Refresh shortly.
        </p>
        <meta httpEquiv="refresh" content="10" />
      </div>
    );
  }

  if (report.status === "cancelled") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-xl font-semibold">Report cancelled</h1>
        <p className="text-muted-foreground">
          {report.error_message || "This report was cancelled before it finished generating."}
        </p>
      </div>
    );
  }

  if (report.status === "failed") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-xl font-semibold text-red-600">Report generation failed</h1>
        <p className="text-muted-foreground">{report.error_message || "Unknown error"}</p>
      </div>
    );
  }

  const html = await renderReportHtmlForView(
    supabase,
    report.project_id,
    (report.report_type as "standard" | "deep") || "standard",
    (report.sections as IntelligenceReportSectionId[] | null) || undefined
  );
  if (!html) notFound();

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
