import { test } from "node:test";
import assert from "node:assert/strict";
import { withJobContext, getJobContext } from "../job-context.ts";

/**
 * P0 fix (hostile-audit punch list item #4): job-context.ts previously stored
 * the active job in a single plain module-level variable ("set once, await
 * the whole job" — explicitly documented as unsafe for interleaved concurrent
 * jobs on a warm instance). cost-guard.ts's recordSpend() reads this context
 * to attribute LLM/provider spend to a specific report/run via
 * increment_report_usage / increment_run_usage — with the old plain-variable
 * implementation, two report-generation jobs racing on the same warm
 * serverless/Inngest worker process could cross-contaminate: job B's awaited
 * work could observe (and bill against) job A's reportId, or clear it out
 * from under A's still-in-flight `finally`.
 *
 * These pin that AsyncLocalStorage now gives each concurrent async call chain
 * its own isolated context, with real interleaving via setTimeout/microtask
 * ordering (not just sequential await, which would pass even with the old
 * plain-variable bug).
 */

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("getJobContext: returns undefined outside any withJobContext scope", () => {
  assert.equal(getJobContext(), undefined);
});

test("withJobContext: context is visible synchronously and after an await inside the callback", async () => {
  await withJobContext({ reportId: "report-1" }, async () => {
    assert.deepEqual(getJobContext(), { reportId: "report-1" });
    await tick(5);
    assert.deepEqual(getJobContext(), { reportId: "report-1" }, "context must survive an await");
  });
  assert.equal(getJobContext(), undefined, "context must not leak after the scope exits");
});

test("withJobContext: two concurrently-interleaved jobs never see each other's context", async () => {
  const observedA: Array<string | undefined> = [];
  const observedB: Array<string | undefined> = [];

  const jobA = withJobContext({ reportId: "report-A" }, async () => {
    observedA.push(getJobContext()?.reportId);
    await tick(10); // yields — job B's callback runs interleaved during this window
    observedA.push(getJobContext()?.reportId);
    await tick(5);
    observedA.push(getJobContext()?.reportId);
  });

  const jobB = withJobContext({ reportId: "report-B" }, async () => {
    await tick(2); // starts slightly after A, guaranteeing overlap with A's first tick(10)
    observedB.push(getJobContext()?.reportId);
    await tick(15);
    observedB.push(getJobContext()?.reportId);
  });

  await Promise.all([jobA, jobB]);

  assert.deepEqual(observedA, ["report-A", "report-A", "report-A"], "job A must only ever see its own context, never job B's");
  assert.deepEqual(observedB, ["report-B", "report-B"], "job B must only ever see its own context, never job A's");
  assert.equal(getJobContext(), undefined, "no context leaks to the outer scope once both jobs finish");
});

test("withJobContext: runId variant is isolated the same way as reportId", async () => {
  const results: Array<string | undefined> = [];
  await Promise.all([
    withJobContext({ runId: "run-1" }, async () => {
      await tick(5);
      results.push(getJobContext()?.runId);
    }),
    withJobContext({ runId: "run-2" }, async () => {
      await tick(1);
      results.push(getJobContext()?.runId);
    }),
  ]);
  assert.deepEqual(new Set(results), new Set(["run-1", "run-2"]));
});

test("withJobContext: nested scopes restore the outer context on exit, not undefined", async () => {
  await withJobContext({ reportId: "outer" }, async () => {
    await withJobContext({ reportId: "inner" }, async () => {
      assert.deepEqual(getJobContext(), { reportId: "inner" });
    });
    assert.deepEqual(getJobContext(), { reportId: "outer" }, "must restore outer context, not clear it");
  });
});

test("withJobContext: propagates the callback's return value and re-throws its errors", async () => {
  const value = await withJobContext({ reportId: "r" }, async () => 42);
  assert.equal(value, 42);

  await assert.rejects(
    () =>
      withJobContext({ reportId: "r" }, async () => {
        throw new Error("boom");
      }),
    /boom/
  );
  assert.equal(getJobContext(), undefined, "context must not leak even when the callback throws");
});
