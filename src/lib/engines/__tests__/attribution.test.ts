import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateAttribution,
  computeMultiTouchAttribution,
  modelChannelAttribution,
  calculateMoMDelta,
  isAiReferralSource,
  type AttributionInputs,
} from "../attribution.ts";
import type { AttributionMetric } from "@/types/database";

/**
 * Attribution & ROI correctness: real-vs-modeled CPC provenance, paid-ads-
 * equivalent math, multi-touch credit allocation, MoM deltas, and AI-referral
 * detection. The refund-critical rule: never fabricate value where there is none.
 */

const base: AttributionInputs = {
  organicTraffic: 0, aiReferralTraffic: 0, socialClicks: 0, directoryReferrals: 0,
  searchClicks: 0, leads: 0, calls: 0, bookings: 0, purchases: 0, revenue: 0,
};

test("zero activity yields zero paid-equivalent and modeled-CPC provenance", () => {
  const a = calculateAttribution("p", base, "2026-01-01", "2026-01-31");
  assert.equal(a.paid_ads_equivalent, 0);
  assert.equal(a.source_breakdown.cpc_is_real, 0, "no real CPC → modeled benchmark");
});

test("real imported CPC is preferred and flagged, lifting paid-equivalent value", () => {
  const inputs: AttributionInputs = { ...base, organicTraffic: 1000, realCpc: 10 };
  const a = calculateAttribution("p", inputs, "2026-01-01", "2026-01-31");
  assert.equal(a.source_breakdown.cpc_is_real, 1);
  assert.equal(a.source_breakdown.cpc_used, 10);
  // 1000 organic clicks × $10 paid-equivalent CPC.
  assert.equal(a.paid_ads_equivalent, 10000);
});

test("industry benchmark CPC is used (and labeled modeled) when no real CPC", () => {
  const a = calculateAttribution("p", { ...base, organicTraffic: 100, industry: "legal" }, "s", "e");
  assert.equal(a.source_breakdown.cpc_is_real, 0);
  assert.equal(a.source_breakdown.cpc_used, 15); // legal benchmark
  assert.equal(a.paid_ads_equivalent, 1500);
});

test("multi-touch: first/last/linear/position-based allocate credit correctly", () => {
  const paths = [["organic", "email", "search"]];
  const first = computeMultiTouchAttribution(paths, "first_touch");
  assert.equal(first.find((c) => c.channel === "organic")?.credit, 1);

  const last = computeMultiTouchAttribution(paths, "last_touch");
  assert.equal(last.find((c) => c.channel === "search")?.credit, 1);

  const linear = computeMultiTouchAttribution(paths, "linear");
  for (const c of linear) assert.ok(Math.abs(c.credit - 0.33) < 0.01);

  const pos = computeMultiTouchAttribution(paths, "position_based");
  assert.equal(pos.find((c) => c.channel === "organic")?.credit, 0.4);
  assert.equal(pos.find((c) => c.channel === "search")?.credit, 0.4);
  assert.equal(pos.find((c) => c.channel === "email")?.credit, 0.2);
});

test("multi-touch credits sum to the number of conversions (percent normalized)", () => {
  const paths = [["a", "b"], ["b", "c"], ["a"]];
  const linear = computeMultiTouchAttribution(paths, "linear");
  const totalPct = linear.reduce((s, c) => s + c.percent, 0);
  assert.ok(Math.abs(totalPct - 100) < 0.5, `percent should sum ~100, got ${totalPct}`);
});

test("modelChannelAttribution weights discovery toward first-touch, intent toward last", () => {
  const totals = { organic: 100, ai_referrals: 100, search: 100 };
  const models = modelChannelAttribution(totals);
  const firstSearch = models.first_touch.find((c) => c.channel === "search")!.percent;
  const lastSearch = models.last_touch.find((c) => c.channel === "search")!.percent;
  // Search (intent) should get MORE last-touch credit than first-touch credit.
  assert.ok(lastSearch > firstSearch, `search last-touch ${lastSearch} should exceed first-touch ${firstSearch}`);
});

test("MoM delta computes change and percent, guarding divide-by-zero", () => {
  const cur = { organic_traffic: 200, revenue: 1000 } as unknown as AttributionMetric;
  const prev = { organic_traffic: 100, revenue: 0 } as unknown as AttributionMetric;
  const delta = calculateMoMDelta(cur, prev);
  assert.equal(delta.organic_traffic.change, 100);
  assert.equal(delta.organic_traffic.changePercent, 100);
  // prev revenue 0, cur > 0 → 100% (not Infinity/NaN).
  assert.equal(delta.revenue.changePercent, 100);
});

test("isAiReferralSource detects AI engines and ignores unrelated sources", () => {
  for (const s of ["chatgpt.com", "www.perplexity.ai", "Gemini", "claude.ai", "copilot.microsoft.com"]) {
    assert.equal(isAiReferralSource(s), true, `${s} should be an AI referral`);
  }
  for (const s of ["google.com", "facebook.com", "newsletter"]) {
    assert.equal(isAiReferralSource(s), false, `${s} should NOT be an AI referral`);
  }
});
