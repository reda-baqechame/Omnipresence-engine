import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "@/lib/security/rate-limit";

/**
 * Stress the in-process rate limiter the way a burst of concurrent requests
 * would hit a hot route (scan trigger, panels run, ops). The contract:
 *   - exactly `limit` calls per key per window are allowed, the rest denied;
 *   - per-key isolation holds (one tenant flooding never starves another);
 *   - it stays correct and fast under tens of thousands of calls (bounded latency).
 */

test("burst: exactly `limit` allowed per key, remainder denied with Retry-After", async () => {
  const key = `burst-${Date.now()}`;
  const limit = 100;
  const burst = 1000;

  // Fire concurrently to mimic a real burst (Promise.all over the sync limiter).
  const results = await Promise.all(
    Array.from({ length: burst }, () => Promise.resolve().then(() => checkRateLimit(key, limit, 60_000)))
  );

  const allowed = results.filter((r) => r.allowed).length;
  const denied = results.filter((r) => !r.allowed);
  assert.equal(allowed, limit, `expected exactly ${limit} allowed, got ${allowed}`);
  assert.equal(denied.length, burst - limit);
  for (const d of denied) {
    assert.ok((d.retryAfterSec ?? 0) >= 1, "denied responses must carry a positive Retry-After");
  }
});

test("per-tenant isolation: flooding tenant A never consumes tenant B's budget", () => {
  const a = `tenantA-${Date.now()}`;
  const b = `tenantB-${Date.now()}`;
  const limit = 50;

  // Tenant A floods well past its limit.
  for (let i = 0; i < limit * 5; i++) checkRateLimit(a, limit, 60_000);
  assert.equal(checkRateLimit(a, limit, 60_000).allowed, false, "A should be throttled");

  // Tenant B is untouched and gets its full fresh allowance.
  let bAllowed = 0;
  for (let i = 0; i < limit; i++) if (checkRateLimit(b, limit, 60_000).allowed) bAllowed++;
  assert.equal(bAllowed, limit, "B's allowance must be fully independent of A");
});

test("window reset: a new window restores allowance", async () => {
  const key = `win-${Date.now()}`;
  // 2 allowed per 50ms window.
  assert.equal(checkRateLimit(key, 2, 50).allowed, true);
  assert.equal(checkRateLimit(key, 2, 50).allowed, true);
  assert.equal(checkRateLimit(key, 2, 50).allowed, false);
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(checkRateLimit(key, 2, 50).allowed, true, "allowance restored after window");
});

test("bounded latency: 50k checks across 500 keys complete fast and correctly", () => {
  const start = performance.now();
  const keys = Array.from({ length: 500 }, (_, i) => `lat-${Date.now()}-${i}`);
  const limit = 20;
  let allowed = 0;
  for (let i = 0; i < 50_000; i++) {
    if (checkRateLimit(keys[i % keys.length], limit, 60_000).allowed) allowed++;
  }
  const elapsedMs = performance.now() - start;
  // 500 keys × 20 allowed each = 10k allowed; the rest denied.
  assert.equal(allowed, keys.length * limit);
  assert.ok(elapsedMs < 2000, `50k checks should be well under 2s, took ${elapsedMs.toFixed(0)}ms`);
});
