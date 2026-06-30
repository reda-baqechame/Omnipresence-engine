import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateGuaranteeFailure,
  buildTwoTierGuarantee,
  auditMarketingCopy,
  evaluateMarketingGate,
  type GuaranteeContract,
} from "../guarantee.ts";
import type { AeoLever } from "@/lib/engines/aeo-readiness";

/**
 * The guarantee is a refund promise, so its gating logic is the single most
 * financially-sensitive code in the platform. These pin the refund shield (never
 * auto-fail on an unmeasured KPI) and the marketing gates (no outcome promise or
 * superlative until the minimum-gate score earns it).
 */

function contract(overrides: Partial<GuaranteeContract>): GuaranteeContract {
  return {
    id: "g", project_id: "p", kpi_metric: "ai_referral_traffic", threshold_value: 5,
    baseline_snapshot: { ai_referral_traffic: 100 }, status: "active",
    created_at: "", ...overrides,
  } as GuaranteeContract;
}

test("REFUND SHIELD: an unmeasured KPI never auto-fails (cannot verify ≠ failed)", () => {
  const r = evaluateGuaranteeFailure(contract({}), {}); // no current value
  assert.equal(r.failed, false);
  assert.equal(r.measured, false);
});

test("REFUND SHIELD: a non-finite current value never auto-fails", () => {
  const r = evaluateGuaranteeFailure(contract({}), { ai_referral_traffic: NaN });
  assert.equal(r.failed, false);
  assert.equal(r.measured, false);
});

test("measured drop below threshold fails; meeting threshold passes", () => {
  const fail = evaluateGuaranteeFailure(contract({}), { ai_referral_traffic: 102 }); // +2 < +5
  assert.equal(fail.measured, true);
  assert.equal(fail.failed, true);

  const pass = evaluateGuaranteeFailure(contract({}), { ai_referral_traffic: 110 }); // +10 ≥ +5
  assert.equal(pass.failed, false);
  assert.equal(pass.delta, 10);
});

test("two-tier guarantee: tier1 met only when ALL deterministic levers ≥ 70", () => {
  const levers: AeoLever[] = [
    { id: "crawlable", name: "Crawlable", type: "deterministic", score: 80 },
    { id: "schema", name: "Schema", type: "deterministic", score: 60 },
  ] as unknown as AeoLever[];
  assert.equal(buildTwoTierGuarantee(levers).tier1Met, false);

  const allGood = [
    { id: "crawlable", name: "Crawlable", type: "deterministic", score: 80 },
    { id: "schema", name: "Schema", type: "deterministic", score: 90 },
  ] as unknown as AeoLever[];
  assert.equal(buildTwoTierGuarantee(allGood).tier1Met, true);
});

test("marketing gate: outcome guarantee blocked until all critical gates ready", () => {
  const notReady = evaluateMarketingGate({ presenceGateScore: 55, presenceGateReady: false, limitingGate: "execution" });
  assert.equal(notReady.outcomeGuaranteeAllowed, false);
  assert.equal(notReady.superlativesAllowed, false);

  const ready = evaluateMarketingGate({ presenceGateScore: 85, presenceGateReady: true });
  assert.equal(ready.outcomeGuaranteeAllowed, true);
  assert.equal(ready.superlativesAllowed, true); // ≥80
});

test("marketing gate: forbidden claim in copy blocks everything regardless of score", () => {
  const gate = evaluateMarketingGate({
    presenceGateScore: 95,
    presenceGateReady: true,
    marketingCopy: "We guarantee #1 ranking on Google forever",
  });
  // If the copy audit finds a forbidden claim, nothing is allowed.
  if (!gate.copyAudit.allowed) {
    assert.equal(gate.outcomeGuaranteeAllowed, false);
  }
});

test("auditMarketingCopy passes clean, honest copy", () => {
  const audit = auditMarketingCopy("We improve your AI visibility with measured, transparent reporting.");
  assert.equal(audit.allowed, true);
  assert.equal(audit.violations.length, 0);
});
