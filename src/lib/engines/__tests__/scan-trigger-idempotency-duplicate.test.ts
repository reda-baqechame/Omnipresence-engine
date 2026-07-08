import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * P1 fix (hostile-audit punch list item #5, "theater tests"): this
 * previously pinned triggerProjectScan()'s idempotency contract by grepping
 * its SOURCE TEXT for string offsets (".eq(...) must come before
 * inngest.send(...)") rather than actually calling the function and
 * observing what it does — a refactor that reordered statements without
 * changing behavior (or vice versa) could pass or fail those assertions for
 * the wrong reason.
 *
 * Node's --experimental-test-module-mocks lets us intercept
 * triggerProjectScan()'s real dependencies (@/lib/supabase/server,
 * @/lib/inngest/client, next/server's after(), @/lib/engines/scan-runner)
 * and actually invoke it, asserting on real call arguments and control flow.
 *
 * Split into one scenario per file (duplicate/sync/inngest) rather than
 * multiple tests in one file: node --test isolates each FILE in its own
 * process, but mock.module()/dynamic-import-caching within a single process
 * means re-mocking the same specifier for a second scenario (e.g. Inngest
 * configured vs not) fights the ESM module cache trigger-scan.ts was
 * already loaded under from the first scenario.
 */

function stubSupabaseWithExistingRun(existingRun: { id: string } | null) {
  return {
    from: (table: string) => {
      assert.equal(table, "visibility_runs");
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: existingRun }),
            }),
          }),
        }),
      };
    },
  };
}

test("triggerProjectScan: an existing idempotency_key row short-circuits to 'duplicate' without sending to Inngest or scheduling any background work", async () => {
  const sendCalls: unknown[] = [];
  const afterCalls: Array<() => unknown> = [];

  mock.module("@/lib/supabase/server", {
    namedExports: { createServiceClient: async () => stubSupabaseWithExistingRun({ id: "existing-run-1" }) },
  });
  mock.module("@/lib/inngest/client", {
    namedExports: { inngest: { send: async (evt: unknown) => sendCalls.push(evt) } },
  });
  mock.module("next/server", {
    namedExports: { after: (fn: () => unknown) => afterCalls.push(fn) },
  });
  mock.module("@/lib/engines/scan-runner", {
    namedExports: {
      runProjectScan: async () => {
        throw new Error("runProjectScan must never be called on the duplicate path");
      },
      getOwnerEmail: async () => undefined,
    },
  });

  const { triggerProjectScan } = await import("../trigger-scan.ts");
  const result = await triggerProjectScan("proj-1", "org-1", { idempotencyKey: "key-abc" });

  assert.deepEqual(result, { mode: "duplicate" });
  assert.equal(sendCalls.length, 0, "must never send to Inngest once a duplicate is detected");
  assert.equal(afterCalls.length, 0, "must never schedule a background/watchdog run once a duplicate is detected");
});
