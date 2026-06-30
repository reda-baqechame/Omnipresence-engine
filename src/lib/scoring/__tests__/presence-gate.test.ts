import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeMinGateScore,
  gateFromRate,
  CRITICAL_GATES,
  type GateScore,
} from "../presence-gate.ts";

/**
 * Unit tests for the minimum-gate PresenceOS Score (Wave T1). The defining
 * property: the composite is the MINIMUM across all critical gates, unavailable
 * gates count as 0, and "ready" requires every gate evaluable and above the bar.
 */

function allGatesAt(score: number): GateScore[] {
  return CRITICAL_GATES.map((gate) => ({ gate, score, available: true }));
}

test("composite is the minimum across gates, not the average", () => {
  const gates = allGatesAt(90);
  gates[5] = { ...gates[5], score: 30 };
  const r = computeMinGateScore(gates);
  assert.equal(r.score, 30);
  assert.equal(r.limitingGate, gates[5].gate);
});

test("a missing/unavailable gate forces the strict score to 0", () => {
  // Provide every gate at 100 except drop one entirely.
  const gates = allGatesAt(100).filter((g) => g.gate !== "attribution");
  const r = computeMinGateScore(gates);
  assert.equal(r.score, 0);
  assert.equal(r.limitingGate, "attribution");
  assert.ok(r.coverage < 1);
  assert.equal(r.ready, false);
});

test("all gates ready above threshold => ready + guaranteeEligible", () => {
  const r = computeMinGateScore(allGatesAt(75), { readyThreshold: 60 });
  assert.equal(r.score, 75);
  assert.equal(r.coverage, 1);
  assert.equal(r.ready, true);
  assert.equal(r.guaranteeEligible, true);
});

test("below threshold => not ready even with full coverage", () => {
  const r = computeMinGateScore(allGatesAt(55), { readyThreshold: 60 });
  assert.equal(r.ready, false);
  assert.equal(r.guaranteeEligible, false);
});

test("availableScore ignores unavailable gates but strict score does not", () => {
  const gates = allGatesAt(80);
  gates[0] = { ...gates[0], available: false, score: 0 };
  const r = computeMinGateScore(gates);
  assert.equal(r.availableScore, 80);
  assert.equal(r.score, 0);
});

test("gateFromRate clamps and scales 0-1 to 0-100", () => {
  assert.equal(gateFromRate("keyword", 0.5).score, 50);
  assert.equal(gateFromRate("keyword", 1.5).score, 100);
  assert.equal(gateFromRate("keyword", -1).score, 0);
});
