import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * P3 fix ("X-Report-Degraded header consistency on stored-PDF responses"):
 * before this fix, only the "stored HTML" and "regenerated HTML" branches of
 * GET /api/report/[token]/pdf set X-Report-Degraded — every genuine PDF
 * branch (stored PDF, regenerated deep PDF, regenerated standard PDF) simply
 * omitted the header. A client checking `headers.get("X-Report-Degraded")`
 * had to treat "false" and "missing" as the same thing across 5 different
 * response branches, which is exactly the kind of implicit contract that
 * silently breaks the moment one branch changes independent of the others.
 *
 * This test drives the real GET handler across every branch and asserts the
 * header is ALWAYS present with the correct explicit value.
 */

interface ReportRow {
  project_id: string;
  is_public: boolean;
  report_type: "standard" | "deep";
  status: string;
  pdf_storage_path: string | null;
  html_storage_path: string | null;
  pdf_degraded: boolean;
  sections: string[] | null;
}

const state: { report: ReportRow | null; storage: Map<string, string> } = {
  report: null,
  storage: new Map(),
};

function resetState(report: ReportRow, storageEntries: Record<string, string> = {}) {
  state.report = report;
  state.storage = new Map(Object.entries(storageEntries));
}

const serviceClient = {
  from: (table: string) => {
    assert.equal(table, "reports");
    return { select: () => ({ eq: () => ({ single: async () => ({ data: state.report }) }) }) };
  },
  storage: {
    from: (bucket: string) => {
      assert.equal(bucket, "reports");
      return {
        download: async (path: string) => {
          const content = state.storage.get(path);
          if (content === undefined) return { data: null, error: { message: "not found" } };
          return { data: { arrayBuffer: async () => new TextEncoder().encode(content).buffer as ArrayBuffer }, error: null };
        },
      };
    },
  },
};

mock.module("@/lib/supabase/server", {
  namedExports: { createServiceClient: async () => serviceClient, createClient: async () => serviceClient },
});

mock.module("@/lib/engines/report-builder", {
  namedExports: {
    renderReportHtmlForView: async () => "<html>legacy-regenerated</html>",
    gatherReportData: async () => ({ reportData: { fake: true }, whiteLabel: undefined }),
  },
});

const providerState: { renderReportPdfResult: Buffer | null } = { renderReportPdfResult: Buffer.from("FAKE-PDF") };
mock.module("@/lib/providers/ai-ui-capture", {
  namedExports: { renderReportPdf: async () => providerState.renderReportPdfResult },
});

const reportPdfState: { shouldThrow: boolean } = { shouldThrow: false };
mock.module("@/lib/engines/report-pdf", {
  namedExports: {
    generateReportPDF: async () => {
      if (reportPdfState.shouldThrow) throw new Error("render failed");
      return Buffer.from("FAKE-STANDARD-PDF");
    },
  },
});

const { GET } = await import("../report/[token]/pdf/route.ts");

function req() {
  return new NextRequest("http://localhost/api/report/tok-1/pdf");
}

function baseReport(overrides: Partial<ReportRow>): ReportRow {
  return {
    project_id: "proj-1",
    is_public: true,
    report_type: "standard",
    status: "ready",
    pdf_storage_path: null,
    html_storage_path: null,
    pdf_degraded: false,
    sections: null,
    ...overrides,
  };
}

test("stored PDF branch: X-Report-Degraded is explicitly \"false\", never omitted", async () => {
  resetState(baseReport({ pdf_storage_path: "reports/proj-1/r1.pdf" }), {
    "reports/proj-1/r1.pdf": "REAL-PDF-BYTES",
  });
  const res = await GET(req(), { params: Promise.resolve({ token: "tok-1" }) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/pdf");
  assert.equal(res.headers.get("X-Report-Source"), "stored");
  assert.equal(res.headers.get("X-Report-Degraded"), "false");
});

test("stored HTML branch: X-Report-Degraded reflects report.pdf_degraded=true honestly", async () => {
  resetState(baseReport({ html_storage_path: "reports/proj-1/r1.html", pdf_degraded: true }), {
    "reports/proj-1/r1.html": "<html>degraded</html>",
  });
  const res = await GET(req(), { params: Promise.resolve({ token: "tok-1" }) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/html");
  assert.equal(res.headers.get("X-Report-Degraded"), "true");
});

test("stored HTML branch: X-Report-Degraded is \"false\" when pdf_degraded=false", async () => {
  resetState(baseReport({ html_storage_path: "reports/proj-1/r1.html", pdf_degraded: false }), {
    "reports/proj-1/r1.html": "<html>not degraded</html>",
  });
  const res = await GET(req(), { params: Promise.resolve({ token: "tok-1" }) });
  assert.equal(res.headers.get("X-Report-Degraded"), "false");
});

test("legacy regenerated deep-report PDF branch: X-Report-Degraded is explicitly \"false\"", async () => {
  resetState(baseReport({ report_type: "deep" }));
  providerState.renderReportPdfResult = Buffer.from("FAKE-DEEP-PDF");
  const res = await GET(req(), { params: Promise.resolve({ token: "tok-1" }) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/pdf");
  assert.equal(res.headers.get("X-Report-Source"), "regenerated");
  assert.equal(res.headers.get("X-Report-Degraded"), "false");
});

test("legacy regenerated standard-report PDF branch: X-Report-Degraded is explicitly \"false\"", async () => {
  resetState(baseReport({ report_type: "standard" }));
  reportPdfState.shouldThrow = false;
  const res = await GET(req(), { params: Promise.resolve({ token: "tok-1" }) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/pdf");
  assert.equal(res.headers.get("X-Report-Source"), "regenerated");
  assert.equal(res.headers.get("X-Report-Degraded"), "false");
});

test("legacy regenerated final HTML fallback: X-Report-Degraded is \"true\" when even on-demand PDF rendering fails", async () => {
  resetState(baseReport({ report_type: "standard" }));
  reportPdfState.shouldThrow = true;
  const res = await GET(req(), { params: Promise.resolve({ token: "tok-1" }) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/html");
  assert.equal(res.headers.get("X-Report-Source"), "regenerated");
  assert.equal(res.headers.get("X-Report-Degraded"), "true");
  reportPdfState.shouldThrow = false;
});

test("deep report with no renderable PDF (provider returns null) falls through to the degraded HTML branch", async () => {
  resetState(baseReport({ report_type: "deep" }));
  providerState.renderReportPdfResult = null;
  const res = await GET(req(), { params: Promise.resolve({ token: "tok-1" }) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/html");
  assert.equal(res.headers.get("X-Report-Degraded"), "true");
  providerState.renderReportPdfResult = Buffer.from("FAKE-DEEP-PDF");
});
