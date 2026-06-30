import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchGoogleOrganicSearxng } from "../searxng.ts";
import { syncGoogleAnalytics } from "@/lib/engines/attribution";

/**
 * Failure-injection: when an external provider is DOWN, ERRORS, or returns
 * GARBAGE, the system must degrade honestly — report unavailable / no-data and
 * NEVER fabricate a result (a false "you rank #1" or a confident $0 is a
 * refund-grade lie). We inject failures at the global fetch boundary and assert
 * every provider returns a safe, non-fabricated shape without throwing.
 */

const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.SEARXNG_URL = "http://searx.test";
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(mode: "down" | "http500" | "garbage") {
  globalThis.fetch = (async () => {
    if (mode === "down") throw new Error("ECONNREFUSED");
    if (mode === "http500") {
      return new Response("upstream error", { status: 500 });
    }
    // garbage: 200 OK but body is not the JSON shape the parser expects
    return new Response("<html>not json</html>", { status: 200, headers: { "Content-Type": "text/html" } });
  }) as typeof fetch;
}

for (const mode of ["down", "http500", "garbage"] as const) {
  test(`SERP provider degrades to unavailable (never fabricates) when upstream is ${mode}`, async () => {
    mockFetch(mode);
    const res = await searchGoogleOrganicSearxng("acme crm", "United States", "acme.com", ["rival"]);
    assert.equal(res.success, false, "must not claim success on a failed/garbage upstream");
    assert.equal((res as { data?: unknown }).data, undefined, "must not fabricate SERP results");
  });

  test(`GA4 attribution reports available:false (never a confident $0) when upstream is ${mode}`, async () => {
    mockFetch(mode);
    const out = await syncGoogleAnalytics("token", "properties/123", "2026-01-01", "2026-01-31");
    assert.equal(out.available, false, "a failed analytics call must be unavailable, not measured");
    // It returns zeros, but flagged unavailable — provenance, not a measured zero.
    assert.equal(out.revenue, 0);
    assert.equal(out.sessions, 0);
  });
}

test("garbage upstream never throws (no unhandled crash in the scan path)", async () => {
  mockFetch("garbage");
  await assert.doesNotReject(async () => {
    await searchGoogleOrganicSearxng("x", "United States", "x.com", []);
    await syncGoogleAnalytics("t", "properties/1", "2026-01-01", "2026-01-31");
  });
});

test("when SERP is unconfigured it reports unavailable, not empty success", async () => {
  delete process.env.SEARXNG_URL;
  const res = await searchGoogleOrganicSearxng("x", "United States", "x.com", []);
  assert.equal(res.success, false);
  assert.match(res.error ?? "", /not configured/i);
});
