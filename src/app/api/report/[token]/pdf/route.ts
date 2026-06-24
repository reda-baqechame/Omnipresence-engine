import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateReportPDF } from "@/lib/engines/report-pdf";
import { generateReportHTML } from "@/lib/engines/report-generator";
import { gatherReportData } from "@/lib/engines/report-builder";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const supabase = await createServiceClient();

  const { data: report } = await supabase
    .from("reports")
    .select("project_id, is_public")
    .eq("share_token", token)
    .single();

  if (!report || !report.is_public) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const gathered = await gatherReportData(supabase, report.project_id);
  if (!gathered) {
    return NextResponse.json({ error: "Report data not found" }, { status: 404 });
  }

  const { reportData, whiteLabel } = gathered;

  try {
    const pdfBuffer = await generateReportPDF(reportData, whiteLabel);
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="omnipresence-${reportData.project.domain}.pdf"`,
      },
    });
  } catch {
    const html = generateReportHTML(reportData, whiteLabel);
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html",
        "Content-Disposition": `attachment; filename="omnipresence-${reportData.project.domain}.html"`,
      },
    });
  }
}
