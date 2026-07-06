import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { renderReportHtmlForView } from "@/lib/engines/report-builder";
import { renderReportPdf } from "@/lib/providers/ai-ui-capture";
import { generateReportPDF } from "@/lib/engines/report-pdf";
import { gatherReportData } from "@/lib/engines/report-builder";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const supabase = await createServiceClient();

  const { data: report } = await supabase
    .from("reports")
    .select("project_id, is_public, report_type, status")
    .eq("share_token", token)
    .single();

  if (!report || !report.is_public) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (report.status === "generating" || report.status === "pending") {
    return NextResponse.json({ error: "Report still generating" }, { status: 202 });
  }

  const reportType = (report.report_type as "standard" | "deep") || "standard";
  const html = await renderReportHtmlForView(supabase, report.project_id, reportType);
  if (!html) {
    return NextResponse.json({ error: "No report data" }, { status: 404 });
  }

  if (reportType === "deep") {
    const pdfBuffer = await renderReportPdf(html);
    if (pdfBuffer) {
      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="intelligence-report.pdf"`,
        },
      });
    }
  } else {
    const gathered = await gatherReportData(supabase, report.project_id);
    if (gathered) {
      try {
        const pdfBuffer = await generateReportPDF(gathered.reportData, gathered.whiteLabel);
        return new NextResponse(new Uint8Array(pdfBuffer), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="report.pdf"`,
          },
        });
      } catch {
        /* fall through to HTML */
      }
    }
  }

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
      "Content-Disposition": `attachment; filename="report.html"`,
    },
  });
}
