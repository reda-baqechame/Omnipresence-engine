import { test, mock } from "node:test";
import assert from "node:assert/strict";

/** See scan-trigger-idempotency-duplicate.test.ts for the full rationale. */

process.env.INNGEST_EVENT_KEY = "test-key";
process.env.SCAN_TRIGGER_MODE = "inngest";

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

test("triggerProjectScan: Inngest configured -> sends idempotencyKey in the event payload instead of using the sync path", async () => {
  const sendCalls: Array<{ name: string; data: Record<string, unknown> }> = [];
  const afterCalls: Array<() => unknown> = [];

  mock.module("@/lib/supabase/server", {
    namedExports: { createServiceClient: async () => stubSupabaseNoExistingRun() },
  });
  mock.module("@/lib/inngest/client", {
    namedExports: {
      inngest: {
        send: async (evt: { name: string; data: Record<string, unknown> }) => {
          sendCalls.push(evt);
        },
      },
    },
  });
  mock.module("next/server", {
    namedExports: { after: (fn: () => unknown) => afterCalls.push(fn) },
  });
  mock.module("@/lib/engines/scan-runner", {
    namedExports: {
      runProjectScan: async () => {
        throw new Error("must not fall back to the sync path when Inngest accepted the event");
      },
      getOwnerEmail: async () => undefined,
    },
  });

  const { triggerProjectScan } = await import("../trigger-scan.ts");
  const result = await triggerProjectScan("proj-3", "org-3", { idempotencyKey: "key-inngest" });

  assert.deepEqual(result, { mode: "inngest" });
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].name, "project/scan.requested");
  assert.equal(
    sendCalls[0].data.idempotencyKey,
    "key-inngest",
    "the Inngest event payload must carry idempotencyKey for cross-run dedupe"
  );
  assert.equal(afterCalls.length, 1, "the Inngest watchdog is still scheduled via after()");
});
