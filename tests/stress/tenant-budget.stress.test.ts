import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Per-tenant daily surface-budget cap: one noisy tenant must never be able to
 * burn the shared paid-API spend for everyone. Under burst it must throw a typed
 * TenantBudgetExceededError once the cap is reached, isolate tenants from each
 * other, and FAIL-OPEN on a DB read error (never wrongly block a paying tenant).
 */

process.env.TENANT_DAILY_CREDIT_CAP = "100";

const { assertTenantSurfaceBudget, TenantBudgetExceededError } = await import("@/lib/metering/api-usage");

/** Minimal chainable Supabase stub: api_usage query resolves to a fixed usage. */
function fakeSupabase(usedTodayByOrg: Record<string, number>, opts: { throwOnRead?: boolean } = {}) {
  return {
    from() {
      let orgId = "";
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(_col: string, val: string) { orgId = val; return builder; },
        async gte() {
          if (opts.throwOnRead) throw new Error("simulated DB outage");
          const used = usedTodayByOrg[orgId] ?? 0;
          return { data: [{ credits_used: used }] };
        },
      };
      return builder;
    },
  } as never;
}

test("burst: a tenant at/over its cap is blocked with a typed error", async () => {
  const sb = fakeSupabase({ noisy: 100 });
  const attempts = 500;
  let blocked = 0;
  let lastErr: unknown = null;
  await Promise.all(
    Array.from({ length: attempts }, async () => {
      try {
        await assertTenantSurfaceBudget(sb, "noisy", 1);
      } catch (e) {
        blocked++;
        lastErr = e;
      }
    })
  );
  assert.equal(blocked, attempts, "every call at the cap must be blocked");
  assert.ok(lastErr instanceof TenantBudgetExceededError);
});

test("isolation: a capped tenant does not affect a low-usage tenant", async () => {
  const sb = fakeSupabase({ noisy: 100, quiet: 2 });
  await assert.rejects(() => assertTenantSurfaceBudget(sb, "noisy", 1), TenantBudgetExceededError);
  // Quiet tenant well under the cap proceeds without throwing.
  await assert.doesNotReject(() => assertTenantSurfaceBudget(sb, "quiet", 1));
});

test("boundary: cap allows exactly up-to-cap and blocks the credit that would exceed it", async () => {
  const sb = fakeSupabase({ org: 99 });
  // used 99 + pending 1 = 100, not > 100 → allowed
  await assert.doesNotReject(() => assertTenantSurfaceBudget(sb, "org", 1));
  // used 99 + pending 2 = 101 > 100 → blocked
  await assert.rejects(() => assertTenantSurfaceBudget(sb, "org", 2), TenantBudgetExceededError);
});

test("fail-open: a DB read error never blocks the tenant", async () => {
  const sb = fakeSupabase({ org: 100 }, { throwOnRead: true });
  await assert.doesNotReject(
    () => assertTenantSurfaceBudget(sb, "org", 1),
    "a limiter/DB outage must fail-open, not hard-block real users"
  );
});

test("disabled by default: no cap env → never blocks", async () => {
  const prev = process.env.TENANT_DAILY_CREDIT_CAP;
  delete process.env.TENANT_DAILY_CREDIT_CAP;
  const sb = fakeSupabase({ org: 10_000 });
  await assert.doesNotReject(() => assertTenantSurfaceBudget(sb, "org", 1));
  process.env.TENANT_DAILY_CREDIT_CAP = prev;
});
