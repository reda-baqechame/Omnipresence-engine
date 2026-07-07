import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

function mockSupabase(org: { api_credits_used: number; api_credit_limit: number }) {
  let used = org.api_credits_used;
  const inserts: unknown[] = [];

  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: { api_credits_used: used, api_credit_limit: org.api_credit_limit } }),
    insert: async (row: unknown) => {
      inserts.push(row);
      return { error: null };
    },
    update: (patch: { api_credits_used: number }) => ({
      eq: async () => {
        used = patch.api_credits_used;
        return { error: null };
      },
    }),
  };

  return {
    supabase: {
      from: (table: string) => {
        if (table === "organizations") return chain;
        if (table === "api_usage") return { insert: chain.insert };
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient,
    getUsed: () => used,
    inserts,
  };
}

describe("api-usage billing enforcement", () => {
  const prevFree = process.env.FREE_ACCESS_MODE;

  beforeEach(() => {
    process.env.FREE_ACCESS_MODE = "false";
  });

  afterEach(() => {
    if (prevFree === undefined) delete process.env.FREE_ACCESS_MODE;
    else process.env.FREE_ACCESS_MODE = prevFree;
  });

  test("trackApiUsage blocks when org would exceed api_credit_limit", async () => {
    const { supabase } = mockSupabase({ api_credits_used: 950, api_credit_limit: 1000 });
    const { trackApiUsage } = await import("../api-usage.ts");

    const blocked = await trackApiUsage(supabase, "org-1", "openai", "content_generate", 100);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 50);
  });

  test("trackApiUsage records usage and returns remaining when under limit", async () => {
    const { supabase, getUsed } = mockSupabase({ api_credits_used: 100, api_credit_limit: 1000 });
    const { trackApiUsage } = await import("../api-usage.ts");

    const ok = await trackApiUsage(supabase, "org-1", "openai", "content_generate", 5);
    assert.equal(ok.allowed, true);
    assert.equal(ok.remaining, 895);
    assert.equal(getUsed(), 105);
  });

  test("assertApiCredits throws ApiCreditExceededError when over limit", async () => {
    const { supabase } = mockSupabase({ api_credits_used: 999, api_credit_limit: 1000 });
    const { assertApiCredits, ApiCreditExceededError } = await import("../api-usage.ts");

    await assert.rejects(
      () => assertApiCredits(supabase, "org-1", 5),
      (err: unknown) => err instanceof ApiCreditExceededError
    );
  });
});
