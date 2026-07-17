import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Patch C.1 (hostile-audit caveat on the otherwise-passed Patch C):
 * gatherReportData() unconditionally called getRealKeywordCpc() — a real,
 * billable Google-Ads-Keyword-Planner-backed call — with NO cancellation
 * checkpoint anywhere in the function. A user who cancelled a deep report
 * immediately could still trigger that one paid lookup, because
 * gatherIntelligenceReport() calls gatherReportData() before its own first
 * checkpoint.
 *
 * These tests exercise the REAL gatherReportData() with getCachedRealKeywordCpc
 * replaced via node:test's mock.module() (never a source-text assertion), so
 * they would FAIL against the pre-Patch-C.1 implementation, which had no
 * `opts.isCancelled` parameter and called the CPC lookup unconditionally.
 *
 * No static imports of production modules besides node:test/assert — every
 * mock.module() call below must run before report-builder.ts (and its
 * transitive imports) are ever loaded.
 */

let cpcCalls: string[][] = [];
let cpcResult: number | null = 7.5;

mock.module("@/lib/providers/keyword-cpc-cache", {
  namedExports: {
    getCachedRealKeywordCpc: async (_supabase: unknown, keywords: string[]) => {
      cpcCalls.push([...keywords]);
      return cpcResult;
    },
  },
});
mock.module("@/lib/engines/proof-report", {
  namedExports: {
    buildProofReport: async () => null,
    renderProofHTML: () => undefined,
  },
});

const { gatherReportData } = await import("../report-builder.ts");

const PROJECT_ROW = {
  id: "proj-1",
  organization_id: "org-1",
  name: "Acme Roofing Co",
  domain: "acmeroofing.com",
  competitors: [] as string[],
  monthly_ad_spend: 5000,
  industry: "local",
  status: "active",
};

const SCORE_ROW = {
  id: "score-1",
  project_id: "proj-1",
  omnipresence_score: 55,
  ai_visibility: 40,
  search_visibility: 60,
  local_visibility: 50,
  social_presence: 45,
  directory_coverage: 70,
  authority_mentions: 35,
  technical_readiness: 65,
  conversion_readiness: 55,
  created_at: "2026-01-15T00:00:00.000Z",
};

const ATTRIBUTION_ROW = {
  organic_traffic: 1200,
  ai_referral_traffic: 300,
  paid_ads_equivalent: 4000,
};

function arrayChain<T>(rows: T[]) {
  const chain = {
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    order() {
      return chain;
    },
    limit() {
      return chain;
    },
    gte() {
      return chain;
    },
    lte() {
      return chain;
    },
    then(resolve: (v: { data: T[] }) => void) {
      resolve({ data: rows });
    },
  };
  return chain;
}

function singleChain<T>(row: T | null) {
  const chain = {
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    order() {
      return chain;
    },
    limit() {
      return chain;
    },
    async single() {
      return { data: row };
    },
    async maybeSingle() {
      return { data: row };
    },
  };
  return chain;
}

/**
 * @param keywordRows non-empty means gatherReportData's kwList will be
 * non-empty, which is the precondition for the CPC block to run at all.
 */
function stubSupabase(opts: { hasAttribution: boolean; keywordRows: string[] }) {
  return {
    from(table: string) {
      switch (table) {
        case "projects":
          return singleChain(PROJECT_ROW);
        case "scores":
          return arrayChain([SCORE_ROW]);
        case "technical_findings":
          return arrayChain([]);
        case "coverage_items":
          return arrayChain([]);
        case "authority_opportunities":
          return arrayChain([]);
        case "roadmaps":
          return singleChain(null);
        case "visibility_results":
          return arrayChain([]);
        case "attribution_metrics":
          return singleChain(opts.hasAttribution ? ATTRIBUTION_ROW : null);
        case "organizations":
          return singleChain(null);
        case "rank_keywords":
          return arrayChain(opts.keywordRows.map((keyword) => ({ keyword, last_position: 8, target_url: null })));
        case "keyword_opportunities":
          return arrayChain(opts.keywordRows.map((keyword) => ({ keyword })));
        case "ai_capture_evidence":
          // Receipts appendix (Master Plan v4 Phase 1) reads latest receipts.
          return arrayChain([]);
        default:
          throw new Error(`unexpected table in report-builder CPC test stub: ${table}`);
      }
    },
  };
}

test("gatherReportData: cancellation requested before the CPC block skips getCachedRealKeywordCpc entirely", async () => {
  cpcCalls = [];
  const supabase = stubSupabase({ hasAttribution: true, keywordRows: ["roofing repair", "roof replacement"] });

  const result = await gatherReportData(supabase as never, "proj-1", {
    isCancelled: async () => true,
  });

  assert.ok(result, "a project with score data must still return a report");
  assert.equal(cpcCalls.length, 0, "getCachedRealKeywordCpc must never be called once cancellation was observed");
  assert.equal(
    result!.reportData.adsEquivalent?.cpcSource,
    "industry_estimate",
    "a cancelled CPC lookup must fall back to the same honest industry_estimate label as an unavailable planner — never a fake 'real'"
  );
});

test("gatherReportData: not cancelled — CPC lookup runs normally and is labeled real", async () => {
  cpcCalls = [];
  cpcResult = 9.25;
  const supabase = stubSupabase({ hasAttribution: true, keywordRows: ["roofing repair", "roof replacement"] });

  const result = await gatherReportData(supabase as never, "proj-1", {
    isCancelled: async () => false,
  });

  assert.ok(result);
  assert.equal(cpcCalls.length, 1, "getCachedRealKeywordCpc must be called exactly once when not cancelled");
  assert.deepEqual(new Set(cpcCalls[0]), new Set(["roofing repair", "roof replacement"]));
  assert.equal(result!.reportData.adsEquivalent?.cpcSource, "real");
});

test("gatherReportData: no isCancelled option provided (standard-report callers) behaves exactly as before — CPC still runs", async () => {
  cpcCalls = [];
  cpcResult = 5;
  const supabase = stubSupabase({ hasAttribution: true, keywordRows: ["roofing repair"] });

  const result = await gatherReportData(supabase as never, "proj-1");

  assert.ok(result);
  assert.equal(cpcCalls.length, 1, "omitting isCancelled must not change existing standard-report behavior");
  assert.equal(result!.reportData.adsEquivalent?.cpcSource, "real");
});

test("gatherReportData: isCancelled is never even called when there is no attribution/keyword data (nothing to cancel)", async () => {
  cpcCalls = [];
  let isCancelledCallCount = 0;
  const supabase = stubSupabase({ hasAttribution: false, keywordRows: [] });

  const result = await gatherReportData(supabase as never, "proj-1", {
    isCancelled: async () => {
      isCancelledCallCount++;
      return false;
    },
  });

  assert.ok(result);
  assert.equal(cpcCalls.length, 0, "no attribution means no CPC lookup regardless of cancellation state");
  assert.equal(isCancelledCallCount, 0, "no reason to even poll cancellation when there is nothing billable to gate");
  assert.equal(result!.reportData.adsEquivalent, undefined, "no attribution means no adsEquivalent at all");
});

test("gatherReportData: cancellation flag resolving true does not affect the free DB reads above the CPC block", async () => {
  cpcCalls = [];
  const supabase = stubSupabase({ hasAttribution: true, keywordRows: ["roofing repair"] });

  const result = await gatherReportData(supabase as never, "proj-1", {
    isCancelled: async () => true,
  });

  assert.ok(result);
  assert.equal(result!.reportData.score.omnipresence_score, 55, "scores/findings/etc. must still load normally when only the CPC step is cancelled");
  assert.equal(result!.reportData.strikingKeywords.length, 1, "striking-distance keywords (a cheap DB read, not the CPC call) must still populate");
});
