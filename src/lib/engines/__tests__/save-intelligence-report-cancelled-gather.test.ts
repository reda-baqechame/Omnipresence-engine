import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Patch C addendum: gatherIntelligenceReport() now returns `{ cancelled: true }`
 * (instead of a usable report) when its bounded-concurrency fan-out observed
 * cancellation mid-flight (see runCancellableSteps in
 * intelligence-report-builder.ts, and deep-report-cancellation-fanout.test.ts
 * for the fan-out's own tests). This file pins the OTHER half of that
 * contract: saveIntelligenceReportArtifacts() — the caller — must treat that
 * result exactly like finalizeIntelligenceReport's own cancellation
 * checkpoints: mark the report row "cancelled" and never invoke narrative
 * generation, HTML generation, or PDF rendering. Before this fix, a
 * `{cancelled:true}`-shaped return from a bounded-concurrency gather had no
 * caller-side handling at all.
 */

let gatherCalls: Array<{ projectId: string; opts: { isCancelled?: () => unknown } }> = [];
let gatherResult: unknown = { cancelled: true };

const narrativeCalls: number[] = [];
const htmlCalls: number[] = [];
const pdfCalls: number[] = [];

// These 4 modules are dynamically imported by saveIntelligenceReportArtifacts
// (report-builder.ts) but also have OTHER real exports used elsewhere in the
// dependency graph that report-builder.ts's static imports reach (e.g.
// visibility-scanner.ts imports several ai-ui-capture exports besides
// renderReportPdf). Mocking with only the one export we care about would
// break those other real call sites, so spread the real module first and
// override just what this test needs.
const realAiUiCapture = await import("@/lib/providers/ai-ui-capture");
const realNarrative = await import("@/lib/engines/intelligence-report-narrative");
const realTemplate = await import("@/lib/engines/intelligence-report-template");

mock.module("@/lib/engines/intelligence-report-builder", {
  namedExports: {
    gatherIntelligenceReport: async (
      _supabase: unknown,
      projectId: string,
      opts: { isCancelled?: () => unknown }
    ) => {
      gatherCalls.push({ projectId, opts });
      return gatherResult;
    },
  },
});
mock.module("@/lib/engines/intelligence-report-template", {
  namedExports: {
    ...realTemplate,
    generateIntelligenceReportHTML: () => {
      htmlCalls.push(1);
      return "<html></html>";
    },
  },
});
mock.module("@/lib/engines/intelligence-report-narrative", {
  namedExports: {
    ...realNarrative,
    generateReportNarrative: async () => {
      narrativeCalls.push(1);
      return { executive: "summary" };
    },
  },
});
mock.module("@/lib/providers/ai-ui-capture", {
  namedExports: {
    ...realAiUiCapture,
    renderReportPdf: async () => {
      pdfCalls.push(1);
      return Buffer.from("%PDF-1.4 stub");
    },
  },
});

function stubSupabase(updates: Record<string, unknown>[], uploads: unknown[]) {
  return {
    from(_table: string) {
      return {
        select() {
          return {
            eq() {
              return { single: async () => ({ data: { sections: null } }) };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          updates.push(payload);
          return {
            eq() {
              return this;
            },
            not() {
              return this;
            },
            select() {
              return this;
            },
            async maybeSingle() {
              return { data: { id: "report-1" } };
            },
          };
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string) {
            uploads.push({ bucket, path });
            return { error: null };
          },
        };
      },
    },
  };
}

const { saveIntelligenceReportArtifacts } = await import("../report-builder.ts");

test("saveIntelligenceReportArtifacts: a {cancelled:true} gather marks the report cancelled and never runs narrative/HTML/PDF", async () => {
  gatherCalls = [];
  gatherResult = { cancelled: true };
  const updates: Record<string, unknown>[] = [];
  const uploads: unknown[] = [];
  const supabase = stubSupabase(updates, uploads);

  const result = await saveIntelligenceReportArtifacts(supabase as never, "proj-1", "report-1", "org-1", {
    isCancelled: async () => true,
  });

  assert.equal(result, "", "must not return a storage path for a cancelled gather");
  assert.equal(narrativeCalls.length, 0, "generateReportNarrative must never run once the gather itself was cancelled");
  assert.equal(htmlCalls.length, 0, "HTML must never be generated once the gather itself was cancelled");
  assert.equal(pdfCalls.length, 0, "PDF must never be rendered once the gather itself was cancelled");
  assert.equal(uploads.length, 0, "no storage upload may happen for a cancelled gather");

  assert.equal(updates.length, 1, "exactly one status update — the cancellation write");
  assert.equal(updates[0].status, "cancelled");
  assert.ok(updates[0].cancelled_at, "cancelled_at must be set");
  assert.notEqual(updates[0].status, "ready");

  assert.equal(gatherCalls.length, 1);
  assert.equal(
    typeof gatherCalls[0].opts.isCancelled,
    "function",
    "the isCancelled callback must be threaded through to gatherIntelligenceReport"
  );
});

test("saveIntelligenceReportArtifacts: a normal (not cancelled) gather still proceeds through narrative/PDF/upload/finalize", async () => {
  gatherCalls = [];
  gatherResult = { cancelled: false, report: {}, branding: undefined };
  narrativeCalls.length = 0;
  htmlCalls.length = 0;
  pdfCalls.length = 0;
  const updates: Record<string, unknown>[] = [];
  const uploads: unknown[] = [];
  const supabase = stubSupabase(updates, uploads);

  const result = await saveIntelligenceReportArtifacts(supabase as never, "proj-1", "report-1", "org-1", {
    isCancelled: async () => false,
  });

  assert.notEqual(result, "");
  assert.equal(narrativeCalls.length, 1);
  assert.equal(pdfCalls.length, 1);
  assert.equal(uploads.length, 2, "both PDF and HTML artifacts must be uploaded");

  const finalUpdate = updates[updates.length - 1];
  assert.equal(finalUpdate.status, "ready");
});
