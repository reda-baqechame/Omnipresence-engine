import { test } from "node:test";
import assert from "node:assert/strict";
import { getValidOAuthToken } from "../tokens.ts";

/**
 * Patch I gap fix: Bing Webmaster tokens previously had no refresh branch, so
 * an expired token silently returned the same (already-expired) access_token
 * forever — every subsequent Bing call would 401 until the user manually
 * reconnected. Google and HubSpot already self-heal; this pins that Bing now
 * does too, and that a failed refresh degrades to the stale token rather than
 * throwing (never worse than the pre-fix behavior).
 */

type FetchImpl = (url: string, init?: RequestInit) => unknown;

function jsonResponse(body: unknown, init?: { status?: number }) {
  return {
    ok: (init?.status ?? 200) < 400,
    status: init?.status ?? 200,
    json: async () => body,
  };
}

async function withFetch(impl: FetchImpl, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(impl(String(url), init))) as unknown as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

interface ConnRow {
  provider: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
}

function fakeSupabase(row: ConnRow | null) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    from(table: string) {
      assert.equal(table, "oauth_connections");
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async single() {
          return { data: row };
        },
        update(payload: Record<string, unknown>) {
          updates.push(payload);
          return {
            eq() {
              return this;
            },
          };
        },
      };
    },
  };
}

const EXPIRED = new Date(Date.now() - 1000).toISOString();
const FUTURE = new Date(Date.now() + 3600_000).toISOString();

test("getValidOAuthToken: non-expired token is returned as-is without any refresh call", async () => {
  let fetchCalled = false;
  await withFetch(
    () => {
      fetchCalled = true;
      return jsonResponse({});
    },
    async () => {
      const supabase = fakeSupabase({
        provider: "bing_webmaster",
        access_token: "still-good",
        refresh_token: "refresh-1",
        expires_at: FUTURE,
      });
      const token = await getValidOAuthToken(supabase as never, "proj-1", "bing_webmaster");
      assert.equal(token, "still-good");
    }
  );
  assert.equal(fetchCalled, false);
});

test("getValidOAuthToken: expired Bing token is refreshed via bing.com/webmasters/oauth/token and persisted", async () => {
  let refreshUrl = "";
  await withFetch(
    (url) => {
      refreshUrl = url;
      return jsonResponse({ access_token: "new-bing-token", expires_in: 3600 });
    },
    async () => {
      const supabase = fakeSupabase({
        provider: "bing_webmaster",
        access_token: "old-expired-token",
        refresh_token: "bing-refresh-1",
        expires_at: EXPIRED,
      });
      const token = await getValidOAuthToken(supabase as never, "proj-1", "bing_webmaster");
      assert.equal(token, "new-bing-token", "must return the freshly refreshed token, not the expired one");
      assert.equal(refreshUrl, "https://www.bing.com/webmasters/oauth/token");
      assert.equal(supabase.updates.length, 1);
      assert.equal(supabase.updates[0].access_token, "new-bing-token");
    }
  );
});

test("getValidOAuthToken: a failed Bing refresh degrades to the stale token (never throws, never worse than before this fix)", async () => {
  await withFetch(
    () => jsonResponse({ error: "invalid_grant" }, { status: 400 }),
    async () => {
      const supabase = fakeSupabase({
        provider: "bing_webmaster",
        access_token: "old-expired-token",
        refresh_token: "bing-refresh-1",
        expires_at: EXPIRED,
      });
      const token = await getValidOAuthToken(supabase as never, "proj-1", "bing_webmaster");
      assert.equal(token, "old-expired-token");
      assert.equal(supabase.updates.length, 0, "a failed refresh must not write a bad update to oauth_connections");
    }
  );
});

test("getValidOAuthToken: no connection at all returns null", async () => {
  const supabase = fakeSupabase(null);
  const token = await getValidOAuthToken(supabase as never, "proj-1", "bing_webmaster");
  assert.equal(token, null);
});

test("getValidOAuthToken: an expired token with no refresh_token returns the (unrefreshable) stale token, not null", async () => {
  const supabase = fakeSupabase({
    provider: "bing_webmaster",
    access_token: "stale",
    refresh_token: null,
    expires_at: EXPIRED,
  });
  const token = await getValidOAuthToken(supabase as never, "proj-1", "bing_webmaster");
  assert.equal(token, "stale");
});
