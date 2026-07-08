import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, checkRateLimitDistributed, getClientIpFromHeaders } from "../rate-limit.ts";
import { checkPublicPageRateLimit } from "../public-guard.ts";

/**
 * Production-critical: the rate limiter guards every public endpoint. These
 * tests pin the core invariants — allow under the cap, block at the cap with a
 * Retry-After, reset after the window, and fail-open to the in-memory backend
 * when Upstash isn't configured (so a limiter outage never hard-blocks users).
 */

test("checkRateLimit allows requests under the limit", () => {
  const key = `t-under-${Math.random()}`;
  assert.equal(checkRateLimit(key, 3, 60_000).allowed, true);
  assert.equal(checkRateLimit(key, 3, 60_000).allowed, true);
  assert.equal(checkRateLimit(key, 3, 60_000).allowed, true);
});

test("checkRateLimit blocks at the limit and returns a positive retryAfter", () => {
  const key = `t-block-${Math.random()}`;
  for (let i = 0; i < 5; i++) checkRateLimit(key, 5, 60_000);
  const blocked = checkRateLimit(key, 5, 60_000);
  assert.equal(blocked.allowed, false);
  assert.ok((blocked.retryAfterSec ?? 0) > 0, "retryAfterSec must be positive when blocked");
});

test("checkRateLimit resets after the window elapses", () => {
  const key = `t-reset-${Math.random()}`;
  // Tiny window: first hit allowed, immediate second hit blocked, then allowed
  // again once the window passes.
  assert.equal(checkRateLimit(key, 1, 1).allowed, true);
  const blocked = checkRateLimit(key, 1, 1).allowed;
  assert.equal(blocked, false);
  // Busy-wait a few ms so Date.now() advances past the 1ms window.
  const until = Date.now() + 5;
  while (Date.now() < until) {
    /* spin */
  }
  assert.equal(checkRateLimit(key, 1, 1).allowed, true);
});

test("checkRateLimitDistributed falls back to in-memory when Upstash is unconfigured", async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const key = `t-dist-${Math.random()}`;
  const first = await checkRateLimitDistributed(key, 2, 60_000);
  assert.equal(first.backend, "memory");
  assert.equal(first.allowed, true);
  await checkRateLimitDistributed(key, 2, 60_000);
  const blocked = await checkRateLimitDistributed(key, 2, 60_000);
  assert.equal(blocked.allowed, false, "distributed limiter must enforce the cap via the memory fallback");
});

/**
 * P0 fix (hostile-audit punch list item #2): the public report share/portal
 * pages had zero rate limiting, so an unauthenticated visitor could hammer a
 * leaked/shared link and force unlimited on-demand regeneration (provider
 * fan-out + LLM narrative + Playwright PDF render — all real spend). These
 * pin getClientIpFromHeaders (the next/headers-compatible IP extractor pages
 * need since they don't receive a NextRequest) and the page-friendly guard
 * built on top of it.
 */
test("getClientIpFromHeaders: prefers x-forwarded-for, takes the first hop", () => {
  const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8", "x-real-ip": "9.9.9.9" });
  assert.equal(getClientIpFromHeaders(headers), "1.2.3.4");
});

test("getClientIpFromHeaders: falls back to x-real-ip, then unknown", () => {
  assert.equal(getClientIpFromHeaders(new Headers({ "x-real-ip": "9.9.9.9" })), "9.9.9.9");
  assert.equal(getClientIpFromHeaders(new Headers()), "unknown");
});

test("checkPublicPageRateLimit: allows under the cap, blocks with retryAfterSec at the cap", async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const ip = `10.0.0.${Math.floor(Math.random() * 255)}`;
  const headers = new Headers({ "x-forwarded-for": ip });
  const namespace = `t-page-rl-${Math.random()}`;

  const first = await checkPublicPageRateLimit(headers, namespace, 2, 60_000);
  assert.equal(first.allowed, true);
  await checkPublicPageRateLimit(headers, namespace, 2, 60_000);
  const blocked = await checkPublicPageRateLimit(headers, namespace, 2, 60_000);
  assert.equal(blocked.allowed, false);
  assert.ok((blocked.retryAfterSec ?? 0) > 0);
});

test("checkPublicPageRateLimit: different IPs get independent buckets", async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const namespace = `t-page-rl-multi-${Math.random()}`;
  const a = await checkPublicPageRateLimit(new Headers({ "x-forwarded-for": "1.1.1.1" }), namespace, 1, 60_000);
  const b = await checkPublicPageRateLimit(new Headers({ "x-forwarded-for": "2.2.2.2" }), namespace, 1, 60_000);
  assert.equal(a.allowed, true);
  assert.equal(b.allowed, true, "a different IP must not be blocked by another IP's bucket");
});
