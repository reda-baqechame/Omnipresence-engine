import { test } from "node:test";
import assert from "node:assert/strict";
import { createStepProgressTracker } from "../job-progress.ts";

/**
 * Patch D: reports.current_step / progress_percent (and the same columns on
 * visibility_runs) were structurally wired end-to-end (DB -> /api/jobs/
 * running -> RunningJobsStrip/JobProgressBar) but functionally dead — no
 * writer existed anywhere, so every running job showed currentStep: null.
 * These tests exercise the REAL createStepProgressTracker() against a fake
 * Supabase client that records every update payload.
 */

interface Update {
  table: string;
  payload: Record<string, unknown>;
  notArgs?: [string, string, string];
}

function fakeSupabase(updates: Update[]) {
  return {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          const record: Update = { table, payload };
          updates.push(record);
          return {
            eq() {
              return this;
            },
            not(col: string, op: string, value: string) {
              record.notArgs = [col, op, value];
              return this;
            },
          };
        },
      };
    },
  };
}

test("createStepProgressTracker: onStepStart writes the first observed step immediately (bypasses throttle)", async () => {
  const updates: Update[] = [];
  const supabase = fakeSupabase(updates);
  const tracker = createStepProgressTracker(supabase as never, "reports", "report-1", ["a", "b", "c"]);

  await tracker.onStepStart("a");

  assert.equal(updates.length, 1);
  assert.equal(updates[0].table, "reports");
  assert.equal(updates[0].payload.current_step, "a");
  assert.equal(updates[0].payload.progress_percent, 0);
});

test("createStepProgressTracker: onStepComplete advances progress_percent based on completed-step count", async () => {
  const updates: Update[] = [];
  const supabase = fakeSupabase(updates);
  const tracker = createStepProgressTracker(supabase as never, "reports", "report-1", ["a", "b", "c", "d"]);

  // Call onStepComplete directly as the FIRST write on a fresh tracker so it
  // isn't itself throttled away by an immediately-preceding onStepStart —
  // the throttle-coalescing behavior is covered by its own test below.
  await tracker.onStepComplete("a");

  const last = updates[updates.length - 1];
  assert.equal(last.payload.current_step, "a");
  assert.equal(last.payload.progress_percent, 25, "1 of 4 steps complete = 25%");
});

test("createStepProgressTracker: progress_percent is always capped below 100 — only the caller's own final write may set 100", async () => {
  const updates: Update[] = [];
  const supabase = fakeSupabase(updates);
  const tracker = createStepProgressTracker(supabase as never, "reports", "report-1", ["a"]);

  await tracker.onStepStart("a");
  await tracker.onStepComplete("a");

  for (const u of updates) {
    assert.ok(
      (u.payload.progress_percent as number) <= 99,
      "tracker-driven writes must never claim 100% — that's reserved for the job's own terminal write"
    );
  }
});

test("createStepProgressTracker: every write is guarded against clobbering a cancelling/cancelled row", async () => {
  const updates: Update[] = [];
  const supabase = fakeSupabase(updates);
  const tracker = createStepProgressTracker(supabase as never, "visibility_runs", "run-1", ["visibility_scan"]);

  await tracker.onStepStart("visibility_scan");

  assert.equal(updates.length, 1);
  assert.ok(updates[0].notArgs, "every progress write must include the cancellation-safe .not() guard");
  assert.equal(updates[0].notArgs?.[0], "status");
  assert.match(
    String(updates[0].notArgs?.[2]),
    /cancelling.*cancelled/,
    "the guard must exclude both cancelling and cancelled rows, same as the final-write pattern elsewhere"
  );
});

test("createStepProgressTracker: rapid onStepComplete calls within the throttle window are coalesced (at most one write per ~2s)", async () => {
  const updates: Update[] = [];
  const supabase = fakeSupabase(updates);
  const tracker = createStepProgressTracker(supabase as never, "reports", "report-1", ["a", "b", "c", "d", "e"]);

  await tracker.onStepStart("a"); // forced (first write)
  await tracker.onStepComplete("a"); // immediately after — should be throttled away
  await tracker.onStepComplete("b"); // still within the throttle window

  assert.equal(updates.length, 1, "only the forced first write should have gone through this fast");
});

test("createStepProgressTracker: onStepProgress computes an in-between-steps fraction correctly", async () => {
  const updates: Update[] = [];
  const supabase = fakeSupabase(updates);
  const tracker = createStepProgressTracker(supabase as never, "visibility_runs", "run-1", [
    "visibility_scan",
    "citation_extraction",
    "scoring",
  ]);

  await tracker.onStepStart("visibility_scan"); // forced write: percent 0
  await tracker.onStepProgress("visibility_scan", 0.5);

  // onStepProgress is throttled too — force a second forced-equivalent
  // scenario isn't available here, so just verify the FIRST call's math by
  // constructing a tracker with a step list where onStepProgress is the
  // very first call (unthrottled).
  const updates2: Update[] = [];
  const supabase2 = fakeSupabase(updates2);
  const tracker2 = createStepProgressTracker(supabase2 as never, "visibility_runs", "run-2", [
    "visibility_scan",
    "citation_extraction",
    "scoring",
  ]);
  await tracker2.onStepProgress("visibility_scan", 0.5);
  assert.equal(updates2.length, 1);
  assert.equal(updates2[0].payload.current_step, "visibility_scan");
  // step 0 of 3, half-done: (0 + 0.5) / 3 * 100 = 16.666... -> rounds to 17
  assert.equal(updates2[0].payload.progress_percent, 17);
});

test("createStepProgressTracker: an unknown step name passed to onStepProgress is a no-op (never fabricates progress for an untracked step)", async () => {
  const updates: Update[] = [];
  const supabase = fakeSupabase(updates);
  const tracker = createStepProgressTracker(supabase as never, "reports", "report-1", ["a", "b"]);

  await tracker.onStepProgress("not-a-real-step", 0.9);

  assert.equal(updates.length, 0);
});

test("createStepProgressTracker: a Supabase write failure never throws — progress tracking must not fail the job it's tracking", async () => {
  const supabase = {
    from() {
      return {
        update() {
          throw new Error("simulated DB outage");
        },
      };
    },
  };
  const tracker = createStepProgressTracker(supabase as never, "reports", "report-1", ["a"]);

  await assert.doesNotReject(() => tracker.onStepStart("a"));
});
