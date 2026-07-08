import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditDataForSeoCategories,
  demotionReadinessReport,
  isPaidDataForSeoAdapter,
  type AuditableAdapter,
} from "../dataforseo-demotion-gate.ts";
import type { ParityGroupSummary, BenchmarkRunRecord } from "../benchmark-dashboard.ts";

function adapter(overrides: Partial<AuditableAdapter> = {}): AuditableAdapter {
  return {
    id: "dataforseo",
    capability: "serp",
    category: "fallback_only",
    paid: true,
    ...overrides,
  };
}

function fakeRecord(overrides: Partial<BenchmarkRunRecord> = {}): BenchmarkRunRecord {
  return {
    id: "row-1",
    capability: "serp",
    metric_name: "failure_rate",
    sovereign_provider: "duckduckgo",
    paid_provider: null,
    dataset_ref: "q1",
    sovereign_value: 0.01,
    paid_value: null,
    delta: null,
    passed: true,
    threshold_note: "note",
    run_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function summary(overrides: Partial<ParityGroupSummary> = {}): ParityGroupSummary {
  return {
    capability: "serp",
    metricName: "failure_rate",
    latest: fakeRecord(),
    consecutivePassDays: 0,
    totalDaysObserved: 1,
    promotionReady: false,
    ...overrides,
  };
}

test("isPaidDataForSeoAdapter: true only for paid adapters whose id is DataForSEO-sourced", () => {
  assert.equal(isPaidDataForSeoAdapter(adapter({ id: "dataforseo", paid: true })), true);
  assert.equal(isPaidDataForSeoAdapter(adapter({ id: "dataforseo-backlinks", paid: true })), true);
  // The sovereign "omnidata" adapter reuses the same client function but is not paid.
  assert.equal(isPaidDataForSeoAdapter(adapter({ id: "omnidata", paid: false })), false);
  // A paid adapter that happens not to be DataForSEO-sourced (e.g. serper) is not in scope.
  assert.equal(isPaidDataForSeoAdapter(adapter({ id: "serper", paid: true })), false);
});

test("auditDataForSeoCategories: no violations when every paid DataForSEO adapter is fallback_only/benchmark_only", () => {
  const adapters = [
    adapter({ id: "dataforseo", capability: "serp", category: "fallback_only" }),
    adapter({ id: "dataforseo-backlinks", capability: "backlinks", category: "benchmark_only" }),
    adapter({ id: "omnidata", capability: "serp", category: "surface_measurement", paid: false }),
  ];
  assert.deepEqual(auditDataForSeoCategories(adapters), []);
});

test("auditDataForSeoCategories: flags a paid DataForSEO adapter promoted to a primary category", () => {
  const adapters = [
    adapter({ id: "dataforseo", capability: "serp", category: "surface_measurement" }),
  ];
  const violations = auditDataForSeoCategories(adapters);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /dataforseo/);
  assert.match(violations[0], /surface_measurement/);
});

test("auditDataForSeoCategories: ignores non-DataForSEO paid adapters entirely", () => {
  const adapters = [adapter({ id: "serper", category: "surface_measurement", paid: true })];
  assert.deepEqual(auditDataForSeoCategories(adapters), []);
});

test("demotionReadinessReport: no evidence yet -> evidenceSupportsFurtherDemotion is false", () => {
  const adapters = [adapter({ id: "dataforseo", capability: "serp", category: "fallback_only" })];
  const report = demotionReadinessReport(adapters, []);
  assert.equal(report.length, 1);
  assert.equal(report[0].capability, "serp");
  assert.equal(report[0].currentlyEnforced, true);
  assert.equal(report[0].metrics.length, 0);
  assert.equal(report[0].evidenceSupportsFurtherDemotion, false);
});

test("demotionReadinessReport: all metrics promotion-ready -> evidenceSupportsFurtherDemotion is true", () => {
  const adapters = [adapter({ id: "dataforseo", capability: "serp", category: "fallback_only" })];
  const summaries = [
    summary({ capability: "serp", metricName: "failure_rate", consecutivePassDays: 30, promotionReady: true }),
    summary({ capability: "serp", metricName: "cost_per_successful_result", consecutivePassDays: 31, promotionReady: true }),
  ];
  const report = demotionReadinessReport(adapters, summaries);
  assert.equal(report[0].evidenceSupportsFurtherDemotion, true);
  assert.equal(report[0].metrics.length, 2);
});

test("demotionReadinessReport: one metric still short of the streak -> not ready (no partial credit)", () => {
  const adapters = [adapter({ id: "dataforseo", capability: "serp", category: "fallback_only" })];
  const summaries = [
    summary({ capability: "serp", metricName: "failure_rate", consecutivePassDays: 30, promotionReady: true }),
    summary({ capability: "serp", metricName: "cost_per_successful_result", consecutivePassDays: 5, promotionReady: false }),
  ];
  const report = demotionReadinessReport(adapters, summaries);
  assert.equal(report[0].evidenceSupportsFurtherDemotion, false);
});

test("demotionReadinessReport: capability with a violated category still reports currentlyEnforced=false", () => {
  const adapters = [adapter({ id: "dataforseo", capability: "serp", category: "surface_measurement" })];
  const report = demotionReadinessReport(adapters, []);
  assert.equal(report[0].currentlyEnforced, false);
});

test("demotionReadinessReport: capability with multiple DataForSEO adapters requires ALL to be enforced", () => {
  const adapters = [
    adapter({ id: "dataforseo", capability: "serp", category: "fallback_only" }),
    adapter({ id: "dataforseo-serp-2", capability: "serp", category: "surface_measurement" }),
  ];
  const report = demotionReadinessReport(adapters, []);
  assert.equal(report.length, 1);
  assert.equal(report[0].dataForSeoAdapterIds.length, 2);
  assert.equal(report[0].currentlyEnforced, false);
});

test("demotionReadinessReport: capabilities with no DataForSEO adapter are omitted entirely", () => {
  const adapters = [
    adapter({ id: "omnidata", capability: "serp", category: "surface_measurement", paid: false }),
    adapter({ id: "serper", capability: "serp", category: "fallback_only", paid: true }),
  ];
  assert.deepEqual(demotionReadinessReport(adapters, []), []);
});
