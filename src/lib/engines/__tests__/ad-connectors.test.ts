import { test } from "node:test";
import assert from "node:assert/strict";
import { blendAdSpend, computeMoneyMath, type AdSpendResult } from "../ad-connectors.ts";

/**
 * Unit tests for ad-account blending (Wave S2) and the pure money math: real
 * imported CPC values organic clicks, and CAC / LTV:CAC compute from real paid
 * spend + realized revenue.
 */

const live = (overrides: Partial<AdSpendResult>): AdSpendResult => ({
  network: "google_ads",
  spend: 0,
  clicks: 0,
  impressions: 0,
  conversions: 0,
  avgCpc: 0,
  available: true,
  ...overrides,
});

test("blendAdSpend computes spend-weighted CPC across available networks", () => {
  const blended = blendAdSpend([
    live({ network: "google_ads", spend: 1000, clicks: 500, conversions: 50 }),
    live({ network: "meta_ads", spend: 500, clicks: 1000, conversions: 25 }),
    live({ network: "linkedin_ads", spend: 999, clicks: 10, available: false }),
  ]);
  // Only the two available networks count: (1000+500)/(500+1000) = 1.0
  assert.equal(blended.available, true);
  assert.equal(blended.spend, 1500);
  assert.equal(blended.clicks, 1500);
  assert.equal(blended.conversions, 75);
  assert.equal(blended.blendedCpc, 1);
  assert.deepEqual(blended.networks, ["google_ads", "meta_ads"]);
});

test("blendAdSpend is unavailable when no network returned data", () => {
  const blended = blendAdSpend([live({ available: false }), live({ available: false })]);
  assert.equal(blended.available, false);
  assert.equal(blended.blendedCpc, 0);
});

test("computeMoneyMath values organic clicks at the given CPC + real CAC/LTV", () => {
  const money = computeMoneyMath({
    organicClicks: 100,
    searchClicks: 0,
    cpc: 7.5,
    purchases: 10,
    revenue: 5000,
    paidSpend: 1500,
    paidConversions: 30,
  });
  // 100 organic clicks * $7.50 = $750.
  assert.equal(money.paidAdsEquivalent, 750);
  // CAC = 1500/30 = 50; LTV = 5000/10 = 500; LTV:CAC = 10.
  assert.equal(money.paidCac, 50);
  assert.equal(money.customerLtv, 500);
  assert.equal(money.ltvToCac, 10);
  // No paid search clicks => 100% of revenue is influenced by measured surfaces.
  assert.equal(money.revenueInfluenced, 5000);
});

test("computeMoneyMath apportions revenue influence against paid search clicks", () => {
  const money = computeMoneyMath({
    organicClicks: 75,
    searchClicks: 25,
    cpc: 4,
    purchases: 0,
    revenue: 1000,
  });
  // 75 / (75+25) = 0.75 of $1000.
  assert.equal(money.revenueInfluenced, 750);
  // No paid data => CAC/LTV are zero (not fabricated).
  assert.equal(money.paidCac, 0);
  assert.equal(money.ltvToCac, 0);
});
