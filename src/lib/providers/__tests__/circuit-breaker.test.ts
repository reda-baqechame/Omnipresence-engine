import { test } from "node:test";
import assert from "node:assert/strict";
import { withBreaker, circuitStatus, resetBreaker, CircuitOpenError } from "../http.ts";

/**
 * The circuit breaker keeps failover snappy: after N consecutive failures it
 * fast-fails a dead provider instead of paying its full timeout on every call.
 * These tests pin open/half-open/closed transitions and the success-resets rule.
 */

test("circuit stays closed and returns results while the call succeeds", async () => {
  const key = `cb-ok-${Math.random()}`;
  resetBreaker(key);
  const out = await withBreaker(key, async () => 42, { threshold: 3 });
  assert.equal(out, 42);
  assert.equal(circuitStatus(key, { threshold: 3 }), "closed");
});

test("circuit opens after threshold consecutive failures and then fast-fails", async () => {
  const key = `cb-open-${Math.random()}`;
  resetBreaker(key);
  const boom = async () => {
    throw new Error("upstream down");
  };
  for (let i = 0; i < 3; i++) {
    await assert.rejects(withBreaker(key, boom, { threshold: 3, cooldownMs: 10_000 }));
  }
  assert.equal(circuitStatus(key, { threshold: 3, cooldownMs: 10_000 }), "open");

  // Next call must fast-fail with CircuitOpenError WITHOUT invoking the function.
  let invoked = false;
  await assert.rejects(
    withBreaker(
      key,
      async () => {
        invoked = true;
        return 1;
      },
      { threshold: 3, cooldownMs: 10_000 }
    ),
    (err: unknown) => err instanceof CircuitOpenError
  );
  assert.equal(invoked, false, "open circuit must not invoke the wrapped fn");
});

test("circuit half-opens after cooldown and a success closes it", async () => {
  const key = `cb-half-${Math.random()}`;
  resetBreaker(key);
  const boom = async () => {
    throw new Error("down");
  };
  // Open with a tiny cooldown so it half-opens almost immediately.
  for (let i = 0; i < 2; i++) {
    await assert.rejects(withBreaker(key, boom, { threshold: 2, cooldownMs: 1 }));
  }
  // Wait out the cooldown window (real timer — spin-waits are flaky under parallel load).
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(circuitStatus(key, { threshold: 2, cooldownMs: 1 }), "half-open");

  // Half-open allows a trial; a success closes the circuit.
  const out = await withBreaker(key, async () => "recovered", { threshold: 2, cooldownMs: 1 });
  assert.equal(out, "recovered");
  assert.equal(circuitStatus(key, { threshold: 2, cooldownMs: 1 }), "closed");
});

test("a success resets the failure count (no premature open)", async () => {
  const key = `cb-reset-${Math.random()}`;
  resetBreaker(key);
  const boom = async () => {
    throw new Error("blip");
  };
  await assert.rejects(withBreaker(key, boom, { threshold: 3 }));
  await assert.rejects(withBreaker(key, boom, { threshold: 3 }));
  // Success before hitting the threshold clears the count.
  await withBreaker(key, async () => 1, { threshold: 3 });
  await assert.rejects(withBreaker(key, boom, { threshold: 3 }));
  assert.equal(circuitStatus(key, { threshold: 3 }), "closed");
});
