import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeIntelligenceReport } from "../report-builder.ts";
import type { IntelligenceReport, IntelligenceReportBranding } from "@/types/intelligence-report.ts";

/**
 * P0 fix (hostile-audit punch list item #1): saveIntelligenceReportArtifacts
 * never checked cancellation, so a user who clicked Stop on a deep report
 * still got a final "ready" report and was still billed for the narrative
 * LLM call + PDF render made after they cancelled.
 *
 * finalizeIntelligenceReport() is the cancellation-aware half of that
 * pipeline (post-gather: narrative -> render -> upload -> finalize),
 * extracted specifically so it can be exercised here with a stubbed
 * Supabase client and stubbed deps instead of the real dynamic-imported
 * provider/PDF-rendering chain (network calls, Playwright microservice,
 * LLM calls) that saveIntelligenceReportArtifacts() wires it up to.
 */

function stubGathered(): { report: IntelligenceReport; branding?: IntelligenceReportBranding } {
  return { report: {} as IntelligenceReport, branding: undefined };
}

/** Minimal chainable Supabase stub covering the calls finalizeIntelligenceReport makes. */
function stubSupabase() {
  const updates: Record<string, unknown>[] = [];
  const uploads: { bucket: string; path: string }[] = [];
  let finalizeShouldSucceed = true;

  const client = {
    from(_table: string) {
      return {
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
              // Simulates the atomic `.not("status", "in", "(cancelling,cancelled)")`
              // guard on the final "ready" write: PATCHing a cancelling/cancelled row
              // matches zero rows, so `.maybeSingle()` resolves with `data: null`.
              return { data: finalizeShouldSucceed ? { id: "report-1" } : null };
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

  return {
    client,
    updates,
    uploads,
    setFinalizeRace(succeeds: boolean) {
      finalizeShouldSucceed = succeeds;
    },
  };
}

function stubDeps(overrides: Partial<{ narrativeCalls: number[]; pdfCalls: number[]; htmlCalls: number[] }> = {}) {
  const narrativeCalls = overrides.narrativeCalls ?? [];
  const pdfCalls = overrides.pdfCalls ?? [];
  const htmlCalls = overrides.htmlCalls ?? [];
  return {
    narrativeCalls,
    pdfCalls,
    htmlCalls,
    deps: {
      generateReportNarrative: async () => {
        narrativeCalls.push(1);
        return { executive: "summary" };
      },
      generateIntelligenceReportHTML: () => {
        htmlCalls.push(1);
        return "<html></html>";
      },
      renderReportPdf: async () => {
        pdfCalls.push(1);
        return Buffer.from("%PDF-1.4 stub");
      },
    },
  };
}

test("finalizeIntelligenceReport: cancelled BEFORE narrative/PDF — report marked cancelled, no narrative/PDF/upload work done", async () => {
  const { client, updates, uploads } = stubSupabase();
  const { deps, narrativeCalls, pdfCalls, htmlCalls } = stubDeps();

  const result = await finalizeIntelligenceReport(
    client as never,
    "proj-1",
    "report-1",
    stubGathered(),
    deps,
    async () => true // already cancelled
  );

  assert.equal(result, "", "must not return a storage path for a cancelled report");
  assert.equal(narrativeCalls.length, 0, "generateReportNarrative must never be invoked once cancelled");
  assert.equal(htmlCalls.length, 0, "HTML must never be generated once cancelled");
  assert.equal(pdfCalls.length, 0, "PDF must never be rendered once cancelled");
  assert.equal(uploads.length, 0, "no storage upload call may be made for a cancelled report");

  assert.equal(updates.length, 1, "exactly one status update — the cancellation write");
  assert.equal(updates[0].status, "cancelled", "report row must be updated to status cancelled, never ready");
  assert.ok(updates[0].cancelled_at, "cancelled_at must be set");
  assert.notEqual(updates[0].status, "ready");
});

test("finalizeIntelligenceReport: cancelled AFTER narrative/PDF (before finalize) — still marked cancelled, not ready", async () => {
  const { client, updates } = stubSupabase();
  const { deps, narrativeCalls, pdfCalls } = stubDeps();

  let calls = 0;
  const result = await finalizeIntelligenceReport(
    client as never,
    "proj-1",
    "report-1",
    stubGathered(),
    deps,
    async () => {
      calls++;
      // First checkpoint (pre-narrative) passes; second checkpoint (post-render,
      // pre-finalize) is where the cancel is observed — pins that the second
      // checkpoint added for the PDF-render window actually fires.
      return calls >= 2;
    }
  );

  assert.equal(result, "");
  assert.equal(narrativeCalls.length, 1, "narrative generation still runs before the second checkpoint");
  assert.equal(pdfCalls.length, 1, "PDF render still runs before the second checkpoint");

  const finalUpdate = updates[updates.length - 1];
  assert.equal(finalUpdate.status, "cancelled");
  assert.notEqual(finalUpdate.status, "ready");
});

test("finalizeIntelligenceReport: not cancelled — proceeds through narrative/PDF/upload and finalizes as ready", async () => {
  const { client, updates, uploads } = stubSupabase();
  const { deps, narrativeCalls, pdfCalls } = stubDeps();

  const result = await finalizeIntelligenceReport(
    client as never,
    "proj-1",
    "report-1",
    stubGathered(),
    deps,
    async () => false
  );

  assert.equal(narrativeCalls.length, 1);
  assert.equal(pdfCalls.length, 1);
  assert.equal(uploads.length, 2, "both PDF and HTML artifacts must be uploaded");
  assert.notEqual(result, "");

  const finalUpdate = updates[updates.length - 1];
  assert.equal(finalUpdate.status, "ready");
  assert.equal(finalUpdate.error_message, null);
});

test("finalizeIntelligenceReport: backward compatible — no isCancelled callback behaves exactly like before (always finalizes)", async () => {
  const { client, updates } = stubSupabase();
  const { deps } = stubDeps();

  const result = await finalizeIntelligenceReport(client as never, "proj-1", "report-1", stubGathered(), deps);

  assert.notEqual(result, "");
  assert.equal(updates[updates.length - 1].status, "ready");
});

test("finalizeIntelligenceReport: loses the race to a concurrent cancel at the final write — does not report success", async () => {
  const { client, updates, setFinalizeRace } = stubSupabase();
  const { deps } = stubDeps();
  setFinalizeRace(false); // simulates the atomic UPDATE ... WHERE status NOT IN (...) matching zero rows

  const result = await finalizeIntelligenceReport(
    client as never,
    "proj-1",
    "report-1",
    stubGathered(),
    deps,
    async () => false // both cooperative checkpoints say "not cancelled"...
  );

  // ...but the atomic guard on the final write still caught a cancel that
  // landed in the gap between the checkpoint read and this write, so the
  // function must not claim success by returning a storage path.
  assert.equal(result, "", "must not return a storage path when the final atomic write is rejected");
  const attemptedFinalWrite = updates.find((u) => u.status === "ready");
  assert.ok(attemptedFinalWrite, "the ready write is attempted (and rejected by the DB-level guard)");
});
