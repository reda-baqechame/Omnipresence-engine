import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * P1 fix (hostile-audit punch list item #6): a genuine end-to-end HTTP
 * integration test that drives the real POST /report, POST /report/cancel,
 * and GET /report/[token]/pdf route handlers back-to-back against a single
 * shared in-memory "database", asserting the full user-facing contract:
 * a report you cancel must never later download as a stale "ready" artifact,
 * and a report that finishes before your cancel request lands must never be
 * silently dropped.
 *
 * report-cancel-route.test.ts / scan-cancel-route.test.ts already cover each
 * cancel route in isolation with full status-matrix coverage; this file's job
 * is specifically the CROSS-ROUTE handoff — the same `reports` row and
 * `share_token` moving through generate -> cancel -> download exactly as a
 * browser session would encounter it.
 *
 * The heavy internals of report generation (real Playwright/PDF rendering,
 * LLM narrative calls) are stubbed via mock.module — they're already covered
 * by dedicated golden tests (report-pdf.test.ts) and the cancellation-aware
 * finalizeIntelligenceReport tests (intelligence-report-sections.test.ts).
 * What this test verifies instead is that the ROUTES agree with each other
 * about a report's lifecycle.
 */

interface ReportRow {
  id: string;
  project_id: string;
  share_token: string;
  is_public: boolean;
  report_type: "standard" | "deep";
  status: string;
  sections: string[];
  idempotency_key: string | null;
  cancel_requested_at: string | null;
  cancelled_at: string | null;
  pdf_storage_path: string | null;
  html_storage_path: string | null;
  pdf_degraded: boolean;
  error_message: string | null;
}

const reportsStore = new Map<string, ReportRow>();
const storageStore = new Map<string, string>();
let reportIdCounter = 0;

function findReport(filters: Record<string, unknown>): ReportRow | undefined {
  return [...reportsStore.values()].find((r) =>
    Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v)
  );
}

function selectChain(filters: Record<string, unknown>) {
  return {
    eq: (col: string, val: unknown) => selectChain({ ...filters, [col]: val }),
    // Versioning's "find the latest report in this lineage" query
    // (.order("version", {ascending:false}).limit(1).maybeSingle()) — filters
    // already narrow to a single project+report_type in these tests, so
    // order/limit are no-ops that just keep the chain going.
    order: () => selectChain(filters),
    limit: () => selectChain(filters),
    single: async () => {
      const row = findReport(filters);
      return { data: row ?? null, error: row ? null : { message: "not found" } };
    },
    maybeSingle: async () => ({ data: findReport(filters) ?? null }),
  };
}

const reportsTable = {
  select: () => selectChain({}),
  insert: (payload: Partial<ReportRow>) => ({
    select: () => ({
      single: async () => {
        const id = `report-${++reportIdCounter}`;
        const row: ReportRow = {
          id,
          project_id: "",
          share_token: `token-${id}`,
          is_public: true,
          report_type: "standard",
          status: "generating",
          sections: [],
          idempotency_key: null,
          cancel_requested_at: null,
          cancelled_at: null,
          pdf_storage_path: null,
          html_storage_path: null,
          pdf_degraded: false,
          error_message: null,
          ...payload,
        };
        reportsStore.set(id, row);
        return { data: row, error: null };
      },
    }),
  }),
  update: (payload: Partial<ReportRow>) => ({
    eq: (col: string, val: unknown) => ({
      in: (col2: string, statuses: string[]) => ({
        select: () => ({
          single: async () => {
            const row = findReport({ [col]: val });
            if (!row || !statuses.includes((row as Record<string, unknown>)[col2] as string)) {
              return { data: null, error: { message: "no rows" } };
            }
            Object.assign(row, payload);
            return { data: { status: row.status }, error: null };
          },
        }),
      }),
      // Plain `.update(...).eq(...)` awaited directly (no .select().single()),
      // used by the sync-path artifact writer.
      then: (resolve: (v: { data: null; error: null }) => void) => {
        const row = findReport({ [col]: val });
        if (row) Object.assign(row, payload);
        resolve({ data: null, error: null });
      },
    }),
  }),
};

const sessionClient = {
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  from: (table: string) => {
    if (table === "projects") {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: "proj-1", organization_id: "org-1" } }) }) }) };
    }
    if (table === "memberships") {
      return { select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: { role: "member" } }) }) }) }) };
    }
    if (table === "organizations") {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { plan: "growth" } }) }) }) };
    }
    if (table === "reports") return reportsTable;
    throw new Error(`unexpected table on session client: ${table}`);
  },
};

const serviceClient = {
  from: (table: string) => {
    if (table === "reports") return reportsTable;
    throw new Error(`unexpected table on service client: ${table}`);
  },
  storage: {
    from: (bucket: string) => {
      assert.equal(bucket, "reports");
      return {
        download: async (path: string) => {
          const content = storageStore.get(path);
          if (content === undefined) return { data: null, error: { message: "not found" } };
          return {
            data: { arrayBuffer: async () => new TextEncoder().encode(content).buffer as ArrayBuffer },
            error: null,
          };
        },
      };
    },
  },
};

mock.module("@/lib/supabase/server", {
  namedExports: { createClient: async () => sessionClient, createServiceClient: async () => serviceClient },
});

mock.module("@/lib/inngest/client", {
  namedExports: { inngest: { send: async () => {} } },
});

// The sync (non-Inngest) standard-report path calls these two directly; stub
// them to simulate "generation succeeded and uploaded a PDF" without paying
// for a real Playwright render — that pipeline has its own golden tests.
mock.module("@/lib/engines/report-builder", {
  namedExports: {
    gatherReportData: async () => ({ reportData: { fake: true }, whiteLabel: undefined }),
    saveReportArtifacts: async (_supabase: unknown, projectId: string, reportId: string) => {
      const path = `reports/${projectId}/${reportId}.pdf`;
      storageStore.set(path, `FAKE-PDF-BYTES-${reportId}`);
      const row = reportsStore.get(reportId);
      if (row) Object.assign(row, { status: "ready", pdf_storage_path: path, pdf_degraded: false });
      return path;
    },
    saveIntelligenceReportArtifacts: async () => {
      throw new Error("not exercised in this test — deep reports go through the Inngest path");
    },
    renderReportHtmlForView: async () => {
      throw new Error("not exercised in this test — every report here has a stored artifact");
    },
  },
});

const { POST: generateReport } = await import("../projects/[id]/report/route.ts");
const { POST: cancelReport } = await import("../projects/[id]/report/[reportId]/cancel/route.ts");
const { GET: downloadReport } = await import("../report/[token]/pdf/route.ts");

function jsonReq(url: string, body: Record<string, unknown>) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Simulates the background job's cooperative-cancellation checkpoint (P0 fix,
 * already unit-tested in intelligence-report-sections.test.ts's
 * finalizeIntelligenceReport suite): once it observes cancel_requested_at, it
 * marks the row cancelled WITHOUT performing narrative/PDF/upload work. */
function simulateBackgroundJobHonoringCancellation(reportId: string) {
  const row = reportsStore.get(reportId);
  assert.ok(row, "report must exist to simulate its background job");
  assert.ok(row!.cancel_requested_at, "background job would only see this path once cancel was requested");
  Object.assign(row!, {
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    error_message: "Cancelled by user",
  });
}

test("full flow: standard report generates synchronously and downloads the exact artifact it produced", async () => {
  const genRes = await generateReport(jsonReq("http://localhost/api/projects/proj-1/report", { report_type: "standard" }), {
    params: Promise.resolve({ id: "proj-1" }),
  });
  const genBody = await genRes.json();
  assert.equal(genRes.status, 200);
  assert.equal(genBody.status, "ready");

  const report = findReport({ share_token: genBody.token })!;
  assert.equal(report.status, "ready");
  assert.equal(report.pdf_storage_path, `reports/proj-1/${report.id}.pdf`);

  const dlRes = await downloadReport(new NextRequest(genBody.url), {
    params: Promise.resolve({ token: genBody.token }),
  });
  assert.equal(dlRes.status, 200);
  assert.equal(dlRes.headers.get("Content-Type"), "application/pdf");
  assert.equal(dlRes.headers.get("X-Report-Source"), "stored");
  assert.equal(dlRes.headers.get("X-Report-Degraded"), "false", "a genuine stored PDF is never degraded");
  const bytes = Buffer.from(await dlRes.arrayBuffer()).toString();
  assert.equal(bytes, `FAKE-PDF-BYTES-${report.id}`, "download must serve the exact artifact generation produced");
});

test("full flow: cancelling a deep report before its background job finishes means download honestly reports cancelled, never a fake/stale PDF", async () => {
  const genRes = await generateReport(jsonReq("http://localhost/api/projects/proj-1/report", { report_type: "deep" }), {
    params: Promise.resolve({ id: "proj-1" }),
  });
  const genBody = await genRes.json();
  assert.equal(genRes.status, 200);
  assert.equal(genBody.status, "generating", "deep reports always go through the async Inngest path");

  const report = findReport({ share_token: genBody.token })!;
  assert.equal(report.status, "pending", "row itself starts pending until the Inngest job picks it up");

  const cancelRes = await cancelReport(new NextRequest("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ id: "proj-1", reportId: report.id }),
  });
  const cancelBody = await cancelRes.json();
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelBody.status, "cancelling");
  assert.ok(report.cancel_requested_at);

  // A download attempted while still "cancelling" (job hasn't converged yet)
  // must not fall through to on-demand regeneration and silently bill/serve
  // a fresh report the user asked to stop.
  const midFlightRes = await downloadReport(new NextRequest(genBody.url), {
    params: Promise.resolve({ token: genBody.token }),
  });
  assert.equal(midFlightRes.status, 202, "still generating/cancelling — must not regenerate or 200");

  simulateBackgroundJobHonoringCancellation(report.id);
  assert.equal(report.pdf_storage_path, null, "a cancelled job must never have produced/uploaded an artifact");

  const dlRes = await downloadReport(new NextRequest(genBody.url), {
    params: Promise.resolve({ token: genBody.token }),
  });
  assert.equal(dlRes.status, 410);
  const body = await dlRes.json();
  assert.equal(body.error, "Report generation was cancelled");
});

test("full flow: a cancel request that loses the race to completion never hides a finished report", async () => {
  const genRes = await generateReport(jsonReq("http://localhost/api/projects/proj-1/report", { report_type: "standard" }), {
    params: Promise.resolve({ id: "proj-1" }),
  });
  const genBody = await genRes.json();
  const report = findReport({ share_token: genBody.token })!;
  assert.equal(report.status, "ready", "the sync path already completed before any cancel could land");

  const cancelRes = await cancelReport(new NextRequest("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ id: "proj-1", reportId: report.id }),
  });
  const cancelBody = await cancelRes.json();
  assert.equal(cancelBody.status, "ready", "a completed report is an idempotent no-op, never flipped after the fact");

  const dlRes = await downloadReport(new NextRequest(genBody.url), {
    params: Promise.resolve({ token: genBody.token }),
  });
  assert.equal(dlRes.status, 200, "the too-late cancel attempt must not block downloading the already-finished report");
  assert.equal(dlRes.headers.get("X-Report-Source"), "stored");
});
