import { test } from "node:test";
import assert from "node:assert/strict";
import { withBreaker, circuitStatus, resetBreaker, CircuitOpenError } from "../http.ts";

/**
 * Integration smoke for the router's failover + circuit-breaker composition.
 *
 * router.ts itself imports many `@/` aliases (not loadable under node --test), so
 * this test reproduces the EXACT route() loop logic against the real breaker
 * primitives and a pair of fake adapters. It proves the production behavior:
 * a dead provider is tried, fails over to a healthy one, and once its circuit
 * opens it is fast-failed (not invoked) on subsequent calls — keeping latency
 * bounded — then recovers cleanly when it comes back.
 */

interface ProviderResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface FakeAdapter {
  id: string;
  run: () => Promise<ProviderResult<string>>;
}

/** Mirror of router.route()'s loop body (breaker + failover + trail). */
async function routeOnce(
  adapters: FakeAdapter[],
  opts: { threshold: number; cooldownMs: number }
): Promise<{ provider?: string; ok: boolean; trail: Array<{ id: string; ok: boolean; error?: string }> }> {
  const trail: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const adapter of adapters) {
    const key = `route:${adapter.id}`;
    try {
      const result = await withBreaker(
        key,
        async () => {
          const r = await adapter.run();
          if (!r.success || r.data === undefined) throw new Error(r.error || "no data");
          return r;
        },
        opts
      );
      trail.push({ id: adapter.id, ok: true });
      return { provider: adapter.id, ok: true, trail };
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        trail.push({ id: adapter.id, ok: false, error: "circuit open" });
        continue;
      }
      trail.push({ id: adapter.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { ok: false, trail };
}

test("dead primary fails over to healthy fallback, then is fast-failed once its circuit opens", async () => {
  const runId = Math.random().toString(36).slice(2);
  let deadInvocations = 0;
  let healthyInvocations = 0;
  const threshold = 3;

  const dead: FakeAdapter = {
    id: `dead-primary-${runId}`,
    run: async () => {
      deadInvocations += 1;
      throw new Error("ECONNREFUSED");
    },
  };
  const healthy: FakeAdapter = {
    id: `healthy-fallback-${runId}`,
    run: async () => {
      healthyInvocations += 1;
      return { success: true, data: "serp-results" };
    },
  };
  const adapters = [dead, healthy];
  const opts = { threshold, cooldownMs: 10_000 };
  resetBreaker(`route:${dead.id}`);
  resetBreaker(`route:${healthy.id}`);

  // First `threshold` calls: dead is tried (fails), healthy serves.
  for (let i = 0; i < threshold; i++) {
    const out = await routeOnce(adapters, opts);
    assert.equal(out.ok, true);
    assert.equal(out.provider, healthy.id);
  }
  assert.equal(deadInvocations, threshold, "dead provider invoked once per call until circuit opens");
  assert.equal(circuitStatus(`route:${dead.id}`, opts), "open");

  // Subsequent calls: dead's circuit is open → fast-failed, NOT invoked again.
  for (let i = 0; i < 5; i++) {
    const out = await routeOnce(adapters, opts);
    assert.equal(out.ok, true);
    assert.equal(out.provider, healthy.id);
    assert.equal(out.trail[0]?.error, "circuit open");
  }
  assert.equal(deadInvocations, threshold, "open circuit must stop invoking the dead provider");
  assert.equal(healthyInvocations, threshold + 5, "healthy fallback served every call");
});

test("recovered primary closes its circuit after the cooldown half-open trial", async () => {
  const runId = Math.random().toString(36).slice(2);
  let fail = true;
  const flaky: FakeAdapter = {
    id: `flaky-${runId}`,
    run: async () => (fail ? { success: false, error: "5xx" } : { success: true, data: "ok" }),
  };
  const opts = { threshold: 2, cooldownMs: 25 };
  const key = `route:${flaky.id}`;
  resetBreaker(key);

  // Open the circuit.
  for (let i = 0; i < 2; i++) await routeOnce([flaky], opts);
  assert.equal(circuitStatus(key, opts), "open");

  // Wait out the cooldown; provider recovers (real timer — spin-waits are flaky under load).
  await new Promise((r) => setTimeout(r, opts.cooldownMs + 15));
  fail = false;
  const out = await routeOnce([flaky], opts);
  assert.equal(out.ok, true);
  assert.equal(out.provider, flaky.id);
  assert.equal(circuitStatus(key, opts), "closed");
});
