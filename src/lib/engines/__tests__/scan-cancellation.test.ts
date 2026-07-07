import { test } from "node:test";
import assert from "node:assert/strict";
import { runVisibilityScan, makeRunCancellationChecker } from "../visibility-scanner.ts";
import type { VisibilityScanConfig } from "../visibility-scanner.ts";

/**
 * Ticket 13 (Phase 0 plan #10): "No golden/E2E tests for the PDF pipeline or
 * cancellation — nothing exercises ... any cancel flow." These pin the
 * cooperative cancellation contract added for user-initiated stop: the scan
 * loop must check `isCancelled` BETWEEN prompt/engine iterations (never
 * mid-probe) and stop before the next provider call, and the DB-backed
 * checker that feeds it must throttle its reads and fail open on error.
 *
 * `engines: []` is used throughout so these exercise the real cancellation
 * checkpoints in runVisibilityScan without invoking any provider/network
 * code — the loop still visits each prompt (and calls isCancelled once per
 * prompt) even with nothing to probe.
 */

function baseConfig(overrides: Partial<VisibilityScanConfig>): VisibilityScanConfig {
  return {
    projectId: "p1",
    runId: "r1",
    brandName: "Acme",
    brandDomain: "acme.com",
    competitors: [],
    location: "United States",
    prompts: [{ text: "prompt 1" }, { text: "prompt 2" }, { text: "prompt 3" }, { text: "prompt 4" }],
    engines: [],
    ...overrides,
  };
}

test("runVisibilityScan: with isCancelled always false, visits every prompt and does not cancel", async () => {
  let calls = 0;
  const out = await runVisibilityScan(
    baseConfig({
      isCancelled: () => {
        calls++;
        return false;
      },
    })
  );
  assert.equal(out.cancelled, false);
  assert.equal(out.scanPartial, false);
  assert.equal(calls, 4, "isCancelled should be polled once per prompt (4 prompts, 0 engines)");
});

test("runVisibilityScan: stops after N iterations once isCancelled flips true (loop stops after N iterations)", async () => {
  let calls = 0;
  const CANCEL_AT_CALL = 2; // cancel while checking prompt #2, before prompt #3/#4 run
  const out = await runVisibilityScan(
    baseConfig({
      isCancelled: () => {
        calls++;
        return calls >= CANCEL_AT_CALL;
      },
    })
  );
  assert.equal(out.cancelled, true);
  assert.equal(out.scanPartial, true, "a cancelled scan must be reported as partial");
  assert.equal(calls, CANCEL_AT_CALL, "must stop checking/iterating immediately once cancelled — no further prompts visited");
});

test("runVisibilityScan: never calls isCancelled when no callback is provided (backward compatible)", async () => {
  const out = await runVisibilityScan(baseConfig({ isCancelled: undefined }));
  assert.equal(out.cancelled, false);
  assert.equal(out.scanPartial, false);
});

/** Minimal chainable Supabase stub — only `.from().select().eq().maybeSingle()` is used. */
function stubSupabase(row: { cancel_requested_at: string | null } | null, opts: { throwOnRead?: boolean } = {}) {
  let reads = 0;
  const client = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          reads++;
          if (opts.throwOnRead) throw new Error("transient DB error");
          return { data: row };
        },
      };
    },
  };
  return { client, getReads: () => reads };
}

test("makeRunCancellationChecker: reflects cancel_requested_at from the DB", async () => {
  const { client } = stubSupabase({ cancel_requested_at: "2026-01-01T00:00:00.000Z" });
  const isCancelled = makeRunCancellationChecker(client as never, "run-1", 0);
  assert.equal(await isCancelled(), true);
});

test("makeRunCancellationChecker: false when cancel_requested_at is null", async () => {
  const { client } = stubSupabase({ cancel_requested_at: null });
  const isCancelled = makeRunCancellationChecker(client as never, "run-1", 0);
  assert.equal(await isCancelled(), false);
});

test("makeRunCancellationChecker: throttles reads — repeated calls within the window reuse the cached value", async () => {
  const { client, getReads } = stubSupabase({ cancel_requested_at: null });
  const isCancelled = makeRunCancellationChecker(client as never, "run-1", 60_000);
  await isCancelled();
  await isCancelled();
  await isCancelled();
  assert.equal(getReads(), 1, "throttle window must prevent hammering the DB once per prompt/engine iteration");
});

test("makeRunCancellationChecker: fails open (returns false) on a transient DB read error", async () => {
  const { client } = stubSupabase(null, { throwOnRead: true });
  const isCancelled = makeRunCancellationChecker(client as never, "run-1", 0);
  // A transient read error must never itself stop a scan.
  assert.equal(await isCancelled(), false);
});
