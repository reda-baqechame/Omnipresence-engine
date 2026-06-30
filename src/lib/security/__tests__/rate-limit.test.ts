import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, checkRateLimitDistributed } from "../rate-limit.ts";

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
