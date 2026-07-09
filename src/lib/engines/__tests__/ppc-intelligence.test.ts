import { test, mock } from "node:test";
import assert from "node:assert/strict";

let serpAvailable = true;
let serpCalls = 0;
let cpcCalls = 0;

mock.module("@/lib/providers/serp-intelligence-router", {
  namedExports: {
    isSerpIntelligenceAvailable: () => serpAvailable,
    serpIntelligenceUnavailableReason: () => "SERP backend unavailable",
    routeSerpIntelligence: async () => {
      serpCalls++;
      return {
        provider: "omnidata",
        organic: [],
        ads: [{ position: 1, title: "Ad", url: "https://rival.example", domain: "rival.example" }],
        peopleAlsoAsk: [],
        localPack: [],
        featureTypes: ["paid"],
      };
    },
  },
});

mock.module("@/lib/providers/keyword-cpc-cache", {
  namedExports: {
    getCachedRealKeywordCpc: async () => {
      cpcCalls++;
      return null;
    },
  },
});

const { captureCompetitorAds, estimatePpcSavings } = await import("../ppc-intelligence.ts");

test("captureCompetitorAds uses routed SERP and returns unavailable when backend inactive", async () => {
  serpAvailable = false;
  serpCalls = 0;
  const off = await captureCompetitorAds(["crm software"]);
  assert.equal(off.available, false);
  assert.equal(serpCalls, 0);

  serpAvailable = true;
  const on = await captureCompetitorAds(["crm software"]);
  assert.equal(on.available, true);
  assert.equal(serpCalls, 1);
  assert.equal(on.advertisers.length, 1);
});

test("captureCompetitorAds respects cancellation before SERP calls", async () => {
  serpAvailable = true;
  serpCalls = 0;
  let cancelled = true;
  const snap = await captureCompetitorAds(["a", "b"], "US", "desktop", {
    isCancelled: async () => cancelled,
  });
  assert.equal(snap.available, false);
  assert.equal(serpCalls, 0);

  cancelled = false;
  serpCalls = 0;
  await captureCompetitorAds(["a"], "US", "desktop", { isCancelled: async () => cancelled });
  assert.equal(serpCalls, 1);
});

test("estimatePpcSavings uses cache-first CPC and labels industry estimate when unavailable", async () => {
  cpcCalls = 0;
  const supabase = {} as never;
  const savings = await estimatePpcSavings({
    supabase,
    organicSessions: 1000,
    aiReferralSessions: 100,
    keywords: ["crm"],
  });
  assert.equal(cpcCalls, 1);
  assert.equal(savings.cpcSource, "industry_estimate");
  assert.equal(savings.cpcProvenance, "unavailable");
  assert.ok(savings.estimatedPaidCost >= 0);
});

test("estimatePpcSavings skips CPC lookup when cancelled", async () => {
  cpcCalls = 0;
  await estimatePpcSavings({
    supabase: {} as never,
    organicSessions: 100,
    aiReferralSessions: 0,
    keywords: ["crm"],
    isCancelled: async () => true,
  });
  assert.equal(cpcCalls, 0);
});
