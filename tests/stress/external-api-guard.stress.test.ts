import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * P0 fix (hostile-audit punch list item #4): dataForSEORequest()/omniDataGet()
 * (dataforseo.ts) and Firecrawl's search/scrape/crawl calls (firecrawl.ts)
 * previously had NO cost guard at all — no rate limit, no budget. Unlike LLM
 * calls (protected by cost-guard.ts's assertWithinBudget), a runaway loop
 * calling these paid providers ran completely unbounded. These pin
 * external-api-guard.ts's runaway-loop protection the same way
 * cost-guard.stress.test.ts pins the LLM guard's.
 */

process.env.EXTERNAL_API_MAX_CALLS_PER_MIN = "150";
process.env.EXTERNAL_API_DAILY_BUDGET_USD = "0"; // 0 disables the USD ceiling for this test
process.env.EXTERNAL_API_MONTHLY_BUDGET_USD = "0";
delete process.env.EXTERNAL_API_BUDGET_DISABLED;

const { assertWithinExternalApiBudget, ExternalApiBudgetExceededError } = await import(
  "@/lib/providers/external-api-guard"
);

test("runaway DataForSEO loop is stopped by the per-instance rate cap (no crash, clean error)", async () => {
  const cap = 150;
  let allowed = 0;
  let blocked = 0;
  let lastError: unknown = null;

  for (let i = 0; i < cap * 3; i++) {
    try {
      await assertWithinExternalApiBudget("dataforseo");
      allowed++;
    } catch (e) {
      blocked++;
      lastError = e;
    }
  }

  assert.ok(allowed <= cap, `allowed (${allowed}) must not exceed the cap (${cap})`);
  assert.ok(blocked > 0, "the runaway loop must eventually be blocked");
  assert.ok(lastError instanceof ExternalApiBudgetExceededError, "must fail with a typed error");
  assert.equal((lastError as InstanceType<typeof ExternalApiBudgetExceededError>).provider, "dataforseo");
});

test("dataforseo and firecrawl rate limits are tracked independently", async () => {
  // dataforseo's cap was already exhausted by the previous test (module-level
  // state, matching cost-guard's own per-instance design) — firecrawl must
  // still have its own independent budget.
  await assert.doesNotReject(() => assertWithinExternalApiBudget("firecrawl"));
});

test("guardDisabled short-circuits both the rate limit and the budget check", async () => {
  process.env.EXTERNAL_API_BUDGET_DISABLED = "true";
  try {
    // dataforseo's rate cap is already blown from the earlier test; with the
    // guard disabled this must still succeed.
    await assert.doesNotReject(() => assertWithinExternalApiBudget("dataforseo"));
  } finally {
    delete process.env.EXTERNAL_API_BUDGET_DISABLED;
  }
});
