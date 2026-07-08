import { test, mock } from "node:test";
import assert from "node:assert/strict";

/** See scan-trigger-idempotency-duplicate.test.ts for the full rationale. */

function stubSupabaseNoExistingRun() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null }),
          }),
        }),
      }),
    }),
  };
}

test("triggerProjectScan: no existing run -> falls through to the sync background path and threads idempotencyKey to runProjectScan", async () => {
  const runCalls: Array<{ projectId: string; options: unknown }> = [];
  const afterCalls: Array<() => unknown> = [];

  delete process.env.INNGEST_EVENT_KEY;
  delete process.env.SCAN_TRIGGER_MODE;

  mock.module("@/lib/supabase/server", {
    namedExports: { createServiceClient: async () => stubSupabaseNoExistingRun() },
  });
  mock.module("@/lib/inngest/client", {
    namedExports: {
      inngest: {
        send: async () => {
          throw new Error("must not use Inngest when INNGEST_EVENT_KEY/SCAN_TRIGGER_MODE aren't configured for it");
        },
      },
    },
  });
  mock.module("next/server", {
    namedExports: { after: (fn: () => unknown) => afterCalls.push(fn) },
  });
  mock.module("@/lib/engines/scan-runner", {
    namedExports: {
      runProjectScan: async (_supabase: unknown, projectId: string, options: unknown) => {
        runCalls.push({ projectId, options });
        return { projectId, score: 50, demo: false };
      },
      getOwnerEmail: async () => "owner@example.com",
    },
  });

  const { triggerProjectScan } = await import("../trigger-scan.ts");
  const result = await triggerProjectScan("proj-2", "org-2", { idempotencyKey: "key-xyz" });

  assert.deepEqual(result, { mode: "sync" });
  assert.equal(afterCalls.length, 1, "must schedule exactly one background task");

  // Drive the scheduled after() callback and assert it actually invokes
  // runProjectScan with the idempotencyKey threaded through — this is the
  // real behavioral assertion the old test could only approximate via regex.
  await afterCalls[0]();
  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0].projectId, "proj-2");
  assert.deepEqual(runCalls[0].options, { notifyEmail: "owner@example.com", idempotencyKey: "key-xyz" });
});
