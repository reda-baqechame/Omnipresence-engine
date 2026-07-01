import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommandCenter } from "../roi-command-center.ts";

/**
 * Provenance honesty for the ROI command center: a channel whose source was NOT
 * healthy this period must be reported as unavailable (so the UI shows "—"),
 * never as a confident 0. Revenue stays gated on the GA4 revenue source.
 */

function mockSupabase(rows: Record<string, unknown>[]) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle() {
          if (table === "attribution_metrics") {
            return Promise.resolve({ data: rows[0] ?? null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (v: { data: Record<string, unknown>[]; error: null }) => void) {
          if (table === "oauth_connections") {
            resolve({ data: [], error: null });
            return;
          }
          resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  };
}

test("no attribution rows → available:false, never fabricated totals", async () => {
  const sb = mockSupabase([]);
  const out = await buildCommandCenter(sb as never, "p1");
  assert.equal(out.available, false);
  assert.equal(out.totals, undefined);
});

test("channelAvailability follows source_availability, not a confident 0", async () => {
  const sb = mockSupabase([
    {
      project_id: "p1",
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      organic_traffic: 1000,
      ai_referral_traffic: 0, // source NOT healthy this period
      social_clicks: 50,
      directory_referrals: 0,
      search_clicks: 200,
      leads: 10,
      revenue: 0,
      paid_ads_equivalent: 300,
      data_source: "measured",
      is_estimated: false,
      source_availability: {
        organicTraffic: true,
        aiReferralTraffic: false, // unavailable, not a real 0
        socialClicks: true,
        searchClicks: true,
        leads: true,
        revenue: false,
        paidAdsEquivalent: true,
      },
    },
  ]);
  const out = await buildCommandCenter(sb as never, "p1");
  assert.equal(out.available, true);
  assert.ok(out.channelAvailability, "channelAvailability is reported");
  // AI referral source was down → unavailable, even though the stored value is 0.
  assert.equal(out.channelAvailability!.aiReferralTraffic, false);
  assert.equal(out.channelAvailability!.organicTraffic, true);
  // Revenue source down → revenue not trustworthy (shown as "—", not $0).
  assert.equal(out.revenueAvailable, false);
});

test("without a source_availability map, a channel is available only if it has a real value", async () => {
  const sb = mockSupabase([
    {
      project_id: "p1",
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      organic_traffic: 1000,
      ai_referral_traffic: 0,
      social_clicks: 0,
      directory_referrals: 0,
      search_clicks: 0,
      leads: 0,
      revenue: 0,
      paid_ads_equivalent: 0,
      data_source: "measured",
      is_estimated: false,
      source_availability: null,
    },
  ]);
  const out = await buildCommandCenter(sb as never, "p1");
  assert.equal(out.channelAvailability!.organicTraffic, true);
  assert.equal(out.channelAvailability!.aiReferralTraffic, false, "a bare 0 with no source map is treated as unavailable");
});
