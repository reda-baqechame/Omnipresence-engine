import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Patch I — canonical first-party connector surface. These tests exercise the
 * REAL getSearchConsoleSnapshot/getGa4Snapshot/getBingWebmasterSnapshot with
 * their two collaborators (getValidOAuthToken, the attribution.ts sync
 * functions) replaced via node:test's mock.module() — never a source-text
 * assertion. The one rule pinned everywhere here: not-connected, not-fully-
 * configured, and a failed live call must ALL return null, never a zeroed or
 * partial snapshot that could be mistaken for real data.
 */

let gscToken: string | null = "gsc-token";
let ga4Token: string | null = "ga4-token";
let bingToken: string | null = "bing-token";
let gscResult = { clicks: 120, impressions: 4000, ctr: 0.03, position: 8.2, available: true };
let ga4Result = { sessions: 500, aiReferrals: 40, leads: 12, revenue: 2500, available: true };
let bingResult = { clicks: 30, impressions: 900, aiCitations: 2, available: true };
const gscCalls: unknown[][] = [];
const ga4Calls: unknown[][] = [];
const bingCalls: unknown[][] = [];

mock.module("@/lib/oauth/tokens", {
  namedExports: {
    getValidOAuthToken: async (_supabase: unknown, _projectId: string, provider: string) => {
      if (provider === "google_search_console") return gscToken;
      if (provider === "google_analytics") return ga4Token;
      if (provider === "bing_webmaster") return bingToken;
      return null;
    },
  },
});

mock.module("@/lib/engines/attribution", {
  namedExports: {
    syncGoogleSearchConsole: async (...args: unknown[]) => {
      gscCalls.push(args);
      return gscResult;
    },
    syncGoogleAnalytics: async (...args: unknown[]) => {
      ga4Calls.push(args);
      return ga4Result;
    },
    syncBingWebmaster: async (...args: unknown[]) => {
      bingCalls.push(args);
      return bingResult;
    },
  },
});

const { getSearchConsoleSnapshot, getGa4Snapshot, getBingWebmasterSnapshot } = await import(
  "../first-party-analytics.ts"
);

function fakeSupabase(ga4Metadata: { property_id?: string } | null) {
  return {
    from(table: string) {
      assert.equal(table, "oauth_connections");
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: ga4Metadata ? { metadata: ga4Metadata } : null };
        },
      };
    },
  };
}

test("getSearchConsoleSnapshot: not connected (no token) returns null, never zeros", async () => {
  gscToken = null;
  const snapshot = await getSearchConsoleSnapshot(fakeSupabase(null) as never, "p1", "example.com");
  assert.equal(snapshot, null);
});

test("getSearchConsoleSnapshot: connected and the live call succeeds returns the real values", async () => {
  gscToken = "gsc-token";
  gscCalls.length = 0;
  const snapshot = await getSearchConsoleSnapshot(fakeSupabase(null) as never, "p1", "example.com");
  assert.ok(snapshot);
  assert.equal(snapshot!.clicks, 120);
  assert.equal(snapshot!.impressions, 4000);
  assert.equal(gscCalls.length, 1);
});

test("getSearchConsoleSnapshot: connected but the live call fails (available:false) returns null, not a confident zero", async () => {
  gscToken = "gsc-token";
  gscResult = { clicks: 0, impressions: 0, ctr: 0, position: 0, available: false };
  const snapshot = await getSearchConsoleSnapshot(fakeSupabase(null) as never, "p1", "example.com");
  assert.equal(snapshot, null);
  gscResult = { clicks: 120, impressions: 4000, ctr: 0.03, position: 8.2, available: true };
});

test("getGa4Snapshot: not connected (no token) returns null", async () => {
  ga4Token = null;
  const snapshot = await getGa4Snapshot(fakeSupabase({ property_id: "properties/123" }) as never, "p1");
  assert.equal(snapshot, null);
});

test("getGa4Snapshot: connected but no property selected yet returns null (not a guessed property)", async () => {
  ga4Token = "ga4-token";
  ga4Calls.length = 0;
  const snapshot = await getGa4Snapshot(fakeSupabase(null) as never, "p1");
  assert.equal(snapshot, null);
  assert.equal(ga4Calls.length, 0, "must never call the live report API without a real property id");
});

test("getGa4Snapshot: connected and configured returns the real property id + values", async () => {
  ga4Token = "ga4-token";
  const snapshot = await getGa4Snapshot(fakeSupabase({ property_id: "properties/123" }) as never, "p1");
  assert.ok(snapshot);
  assert.equal(snapshot!.propertyId, "properties/123");
  assert.equal(snapshot!.sessions, 500);
  assert.equal(snapshot!.revenue, 2500);
});

test("getBingWebmasterSnapshot: not connected returns null", async () => {
  bingToken = null;
  const snapshot = await getBingWebmasterSnapshot(fakeSupabase(null) as never, "p1", "example.com");
  assert.equal(snapshot, null);
});

test("getBingWebmasterSnapshot: connected and the live call succeeds returns the real values", async () => {
  bingToken = "bing-token";
  bingCalls.length = 0;
  const snapshot = await getBingWebmasterSnapshot(fakeSupabase(null) as never, "p1", "example.com");
  assert.ok(snapshot);
  assert.equal(snapshot!.clicks, 30);
  assert.equal(snapshot!.aiCitations, 2);
  assert.equal(bingCalls.length, 1);
});

test("getBingWebmasterSnapshot: connected but the live call fails returns null, not zeros", async () => {
  bingToken = "bing-token";
  bingResult = { clicks: 0, impressions: 0, aiCitations: 0, available: false };
  const snapshot = await getBingWebmasterSnapshot(fakeSupabase(null) as never, "p1", "example.com");
  assert.equal(snapshot, null);
});
