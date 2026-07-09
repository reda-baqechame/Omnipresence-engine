import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveState, type ProofState } from "../provider-proof.ts";
import type { BenchmarkRunRecord, ParityGroupSummary } from "../benchmark-dashboard.ts";

const LABELS: Record<ProofState, string> = {
  infrastructure_ready_no_evidence: "Infrastructure ready, no benchmark evidence yet",
  smoke_in_progress: "7-day smoke in progress",
  promotion_not_met: "30-day promotion not met",
  benchmark_proven: "Benchmark-proven for this capability",
  fallback_only: "Fallback only",
  unavailable: "Unavailable",
};

function latest(metricName = "failure_rate"): BenchmarkRunRecord {
  return {
    id: "r1",
    capability: "serp",
    metric_name: metricName,
    sovereign_provider: "omnidata",
    paid_provider: "dataforseo",
    input_ref: "q1",
    sovereign_value: 0.01,
    paid_value: 0.01,
    delta: 0,
    passed: true,
    threshold_note: "test",
    run_at: "2026-07-01T00:00:00.000Z",
  };
}

function group(
  partial: Partial<ParityGroupSummary> & { metricName: string }
): ParityGroupSummary {
  return {
    capability: "serp",
    metricName: partial.metricName,
    consecutivePassDays: partial.consecutivePassDays ?? 0,
    totalDaysObserved: partial.totalDaysObserved ?? 1,
    promotionReady: partial.promotionReady ?? false,
    latest: partial.latest ?? latest(partial.metricName),
  };
}

test("provider proof states cover honest UI copy", () => {
  assert.ok(!Object.values(LABELS).some((l) => /parity achieved|replaces dataforseo/i.test(l)));
  assert.match(LABELS.infrastructure_ready_no_evidence, /no benchmark evidence/i);
  assert.match(LABELS.benchmark_proven, /Benchmark-proven/);
});

test("deriveState: empty groups => infrastructure_ready_no_evidence when sovereign exists", () => {
  const r = deriveState([], true, true);
  assert.equal(r.state, "infrastructure_ready_no_evidence");
  assert.equal(r.promotionReady, false);
});

test("deriveState: requires ALL metrics promotionReady for benchmark_proven", () => {
  const groups = [
    group({ metricName: "failure_rate", consecutivePassDays: 30, promotionReady: true }),
    group({ metricName: "cost_per_successful_result", consecutivePassDays: 5, promotionReady: false }),
  ];
  const r = deriveState(groups, true, true);
  assert.notEqual(r.state, "benchmark_proven");
  assert.equal(r.promotionReady, false);
});

test("deriveState: all metrics promotionReady => benchmark_proven", () => {
  const groups = [
    group({ metricName: "failure_rate", consecutivePassDays: 30, promotionReady: true }),
    group({ metricName: "serp_top10_overlap", consecutivePassDays: 30, promotionReady: true }),
  ];
  const r = deriveState(groups, true, true);
  assert.equal(r.state, "benchmark_proven");
  assert.equal(r.promotionReady, true);
});

test("deriveState: failed/zero-streak rows are promotion_not_met, not no-evidence", () => {
  const groups = [group({ metricName: "failure_rate", consecutivePassDays: 0, promotionReady: false })];
  const r = deriveState(groups, true, true);
  assert.equal(r.state, "promotion_not_met");
});
