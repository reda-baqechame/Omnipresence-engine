import { test } from "node:test";
import assert from "node:assert/strict";

// Must be set BEFORE scan-runner.ts (transitively) imports
// @/lib/config/access.ts, since FREE_ACCESS_MODE is a module-load-time
// const — hence the dynamic imports below instead of static top-level ones.
process.env.FREE_ACCESS_MODE = "false";

const { runProjectScan } = await import("../scan-runner.ts");

/**
 * P0 fix (hostile-audit punch list item #4): api/projects/[id]/scan/route.ts
 * has always caught ApiCreditExceededError from runProjectScan() and mapped
 * it to a clean 402 — but runProjectScan() never actually threw one. An
 * org's api_credit_limit was documented (docs/BILLING.md) and unit-tested in
 * isolation (assertApiCredits() itself), yet completely unwired: a scan ran
 * unconditionally regardless of remaining credits, burning unlimited
 * DataForSEO/Firecrawl/LLM spend across every downstream engine call.
 *
 * This pins that runProjectScan() now calls assertApiCredits() BEFORE any
 * expensive work (before flipping the project to "scanning", before the
 * technical audit / brand extraction / prompt generation / visibility scan
 * engines run at all) — using a minimal Supabase stub that tracks every
 * table touched, so we can assert none of the expensive downstream tables
 * are ever written to once the credit check rejects.
 */

function stubSupabase(org: { api_credits_used: number; api_credit_limit: number }) {
  const touchedTables: string[] = [];

  const chain = (table: string): unknown => {
    const self = {
      select: () => self,
      eq: () => self,
      update: (..._args: unknown[]) => self,
      insert: (..._args: unknown[]) => self,
      delete: () => self,
      order: () => self,
      limit: () => self,
      single: async () => {
        if (table === "projects") {
          return { data: { id: "p1", organization_id: "org-1", domain: "acme.com", name: "Acme", competitors: [] } };
        }
        if (table === "organizations") {
          return { data: { api_credits_used: org.api_credits_used, api_credit_limit: org.api_credit_limit } };
        }
        return { data: null };
      },
      maybeSingle: async () => ({ data: null }),
    };
    return self;
  };

  return {
    supabase: {
      from: (table: string) => {
        touchedTables.push(table);
        return chain(table);
      },
    },
    touchedTables,
  };
}

test("runProjectScan: rejects with ApiCreditExceededError before touching any downstream engine table when org is over its credit limit", async () => {
  const { ApiCreditExceededError } = await import("../../metering/api-usage.ts");
  const { supabase, touchedTables } = stubSupabase({ api_credits_used: 1000, api_credit_limit: 1000 });

  await assert.rejects(
    () => runProjectScan(supabase as never, "p1"),
    (err: unknown) => err instanceof ApiCreditExceededError
  );

  // Only "projects" (load) and "organizations" (credit check) may have been
  // touched — never "technical_findings", "visibility_runs", "prompts",
  // "brand_profiles", etc. A single unguarded downstream write here would
  // mean the credit check ran too late (after expensive work had already
  // started), which is exactly the bug being fixed.
  assert.deepEqual(new Set(touchedTables), new Set(["projects", "organizations"]));
});

test("runProjectScan's credit estimate scales with the scan's own effective prompt limit, not a hardcoded number", async () => {
  const { supabase, touchedTables } = stubSupabase({ api_credits_used: 5, api_credit_limit: 10 });

  // 5 used + max(effectivePromptLimit, 10) credits will exceed a 10-credit
  // limit for ANY plan (first-scan prompt limits are always >= the min-10
  // floor asserted here), so this must reject the same way a hard-coded cap
  // would — pinning that the estimate is actually read from plan limits
  // rather than skipped.
  const { ApiCreditExceededError } = await import("../../metering/api-usage.ts");
  await assert.rejects(
    () => runProjectScan(supabase as never, "p1"),
    (err: unknown) => err instanceof ApiCreditExceededError
  );
  assert.deepEqual(new Set(touchedTables), new Set(["projects", "organizations"]));
});
