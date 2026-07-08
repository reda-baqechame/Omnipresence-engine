import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { renderReportHtmlForView } from "@/lib/engines/report-builder";
import { renderReportPdf } from "@/lib/providers/ai-ui-capture";
import { generateReportPDF } from "@/lib/engines/report-pdf";
import { gatherReportData } from "@/lib/engines/report-builder";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { checkRateLimitDistributed, rateLimitResponse } from "@/lib/security/rate-limit";
import type { IntelligenceReportSectionId } from "@/types/intelligence-report";

export const runtime = "nodejs";
// The deep-report PDF path calls out to the ai-ui-capture Playwright service
// (REPORT_PDF_TIMEOUT_MS, default 90s) — give this route enough headroom on
// hosts that respect maxDuration so a slow render doesn't hard-cut mid-stream.
export const maxDuration = 120;

async function bufferFromStorage(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  path: string
): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from("reports").download(path);
  if (error || !data) return null;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Per-IP guard: a share token is an unguessable 128-bit capability URL, not
  // a brute-forceable secret, but this endpoint's fallback path (legacy
  // reports missing a stored artifact) triggers real, billable regeneration —
  // full provider fan-out, an LLM narrative call, and a Playwright PDF render.
  // Unlimited hits from one IP must not be able to force unbounded spend.
  const ipLimited = await guardPublicEndpoint(request, "report-pdf", 60, 60_000);
  if (ipLimited) return ipLimited;

  // Per-token guard (not per-IP): protects a single leaked/shared link from
  // being hammered across many source IPs — a distributed scraper hitting one
  // token from 1000 IPs would sail through the per-IP limiter above.
  const tokenLimit = await checkRateLimitDistributed(`report-pdf-token:${token}`, 120, 60_000);
  if (!tokenLimit.allowed) return rateLimitResponse(tokenLimit.retryAfterSec || 60);

  const supabase = await createServiceClient();

  const { data: report } = await supabase
    .from("reports")
    .select(
      "project_id, is_public, report_type, status, pdf_storage_path, html_storage_path, pdf_degraded, sections"
    )
    .eq("share_token", token)
    .single();

  if (!report || !report.is_public) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (report.status === "generating" || report.status === "pending") {
    return NextResponse.json({ error: "Report still generating" }, { status: 202 });
  }

  if (report.status === "cancelled") {
    return NextResponse.json({ error: "Report generation was cancelled" }, { status: 410 });
  }

  if (report.status === "failed") {
    return NextResponse.json({ error: "Report generation failed" }, { status: 422 });
  }

  const reportType = (report.report_type as "standard" | "deep") || "standard";

  // Prefer the artifact that generation actually produced and stored — this is
  // what was reviewed/shared, not a live recomputation from whatever the
  // project's data looks like right now. Falls back to on-demand generation
  // only for reports created before this artifact-path scheme existed, or if
  // the stored object is missing.
  if (report.pdf_storage_path) {
    const buffer = await bufferFromStorage(supabase, report.pdf_storage_path);
    if (buffer) {
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${reportType === "deep" ? "intelligence-report" : "report"}.pdf"`,
          "X-Report-Source": "stored",
        },
      });
    }
  }

  if (report.html_storage_path) {
    const buffer = await bufferFromStorage(supabase, report.html_storage_path);
    if (buffer) {
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "text/html",
          "Content-Disposition": `attachment; filename="report.html"`,
          "X-Report-Source": "stored",
          // Honest signal: the client asked to download a report and is
          // receiving HTML because PDF rendering degraded at generation time
          // (deep-report Playwright service unavailable, or PDF render
          // failed) — never silently disguise this as a PDF.
          "X-Report-Degraded": report.pdf_degraded ? "true" : "false",
        },
      });
    }
  }

  // Legacy fallback for reports generated before artifact paths were
  // persisted: regenerate on demand. This path is expected to shrink to zero
  // as old reports age out via report-retention pruning.
  const html = await renderReportHtmlForView(
    supabase,
    report.project_id,
    reportType,
    (report.sections as IntelligenceReportSectionId[] | null) || undefined
  );
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
          "X-Report-Source": "regenerated",
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
            "X-Report-Source": "regenerated",
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
      "X-Report-Source": "regenerated",
      "X-Report-Degraded": "true",
    },
  });
}
