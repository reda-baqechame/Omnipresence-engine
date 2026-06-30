import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Stress the LLM cost-guard's runaway-loop protection. A tight loop calling a
 * paid provider must be stopped by the per-instance rate cap with a clean
 * BudgetExceededError (degrade-to-unavailable), never crash and never run
 * unbounded. We isolate Layer 2 by setting a small calls/min cap and leaving the
 * USD budget effectively unlimited (no Supabase configured → cached $0 spend).
 */

// Set the env BEFORE importing the module (it reads process.env at call time, so
// this is safe, but we keep it explicit and ordered).
process.env.LLM_MAX_CALLS_PER_MIN = "200";
process.env.LLM_DAILY_BUDGET_USD = "0"; // 0 disables the USD ceiling for this test
process.env.LLM_MONTHLY_BUDGET_USD = "0";
delete process.env.LLM_BUDGET_DISABLED;

const { assertWithinBudget, BudgetExceededError, estimateCostUsd, maxOutputTokens } = await import(
  "@/lib/providers/cost-guard"
);

test("runaway loop is stopped by the per-instance rate cap (no crash, clean error)", async () => {
  const cap = 200;
  let allowed = 0;
  let blocked = 0;
  let lastError: unknown = null;

  // Fire many more than the cap in a tight loop, as a runaway job would.
  for (let i = 0; i < cap * 3; i++) {
    try {
      await assertWithinBudget("openai");
      allowed++;
    } catch (e) {
      blocked++;
      lastError = e;
    }
  }

  assert.ok(allowed <= cap, `allowed (${allowed}) must not exceed the cap (${cap})`);
  assert.ok(blocked > 0, "the runaway loop must eventually be blocked");
  assert.ok(lastError instanceof BudgetExceededError, "must fail with a typed BudgetExceededError");
});

test("cost estimate is monotonic in tokens and never negative", () => {
  const small = estimateCostUsd("gpt-4o-mini", 100, 100);
  const large = estimateCostUsd("gpt-4o-mini", 10_000, 10_000);
  assert.ok(large > small);
  assert.ok(small >= 0);
  // Unknown model uses the conservative default (non-zero), never free.
  assert.ok(estimateCostUsd("some-unknown-model", 1000, 1000) > 0);
});

test("output token caps are bounded and kind-aware", () => {
  assert.ok(maxOutputTokens("probe") > 0);
  assert.ok(maxOutputTokens("content") >= maxOutputTokens("probe"));
});
