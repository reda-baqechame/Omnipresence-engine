import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { OmniPresenceReportPDF } from "@/lib/engines/report-pdf-document";
import type { ReportData } from "@/lib/engines/report-generator";

export async function generateReportPDF(
  data: ReportData,
  whiteLabel?: { name: string; color: string }
): Promise<Buffer> {
  return renderToBuffer(
    <OmniPresenceReportPDF data={data} whiteLabel={whiteLabel} />
  );
}
