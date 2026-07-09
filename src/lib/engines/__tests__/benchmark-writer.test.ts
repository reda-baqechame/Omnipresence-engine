import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveBenchmarkRows,
  persistBenchmarkRun,
  FAILURE_RATE_MAX,
  BACKLINK_OVERLAP_MIN,
  MIN_SAMPLES_FOR_STATISTICAL_PASS,
} from "../benchmark-writer.ts";
import type { BenchmarkReport, CapabilityResult } from "../provider-benchmark.ts";

/**
 * PresenceData OS benchmark layer: pins the Section 9 threshold math AND the
 * honesty rule that `passed` is null (never coerced) whenever a metric
 * genuinely wasn't evaluated this run — small sample size, or no paid
 * comparison ran.
 */

function sovereignOnly(success: boolean, costPerCallUsd = 0): CapabilityResult {
  return {
    input: "input-1",
    sovereign: { ran: true, success, ms: 100, provider: "sovereign-x", costPerCallUsd, count: success ? 5 : 0 },
    paid: null,
    verdict: "sovereign-only",
  };
}

function withPaid(
  sovSuccess: boolean,
  paidSuccess: boolean,
  opts: { sovCost?: number; paidCost?: number; overlap?: number } = {}
): CapabilityResult {
  return {
    input: "input-1",
    sovereign: { ran: true, success: sovSuccess, ms: 100, provider: "sovereign-x", costPerCallUsd: opts.sovCost ?? 0, count: 10 },
    paid: { ran: true, success: paidSuccess, ms: 200, provider: "paid-vendor", costPerCallUsd: opts.paidCost ?? 0.02, count: 8 },
    overlap: opts.overlap,
    verdict: "compared",
  };
}

function baseReport(overrides: Partial<BenchmarkReport>): BenchmarkReport {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 500,
    crawl: [],
    backlinks: [],
    serp: [],
    generate: [],
    summary: { sovereignCostUsd: 0, paidCostUsd: 0, costSavedUsd: 0, sovereignWins: 0, total: 0, notes: [] },
    ...overrides,
  };
}

test("failure_rate: below the statistical-sample floor is recorded as informational (passed=null), never a false pass", () => {
  const report = baseReport({ crawl: [sovereignOnly(true), sovereignOnly(true)] });
  const rows = deriveBenchmarkRows(report);
  const fr = rows.find((r) => r.capability === "crawl" && r.metric_name === "failure_rate");
  assert.ok(fr);
  assert.equal(fr!.passed, null, "n=2 is below MIN_SAMPLES_FOR_STATISTICAL_PASS — must not claim a real pass/fail");
  assert.equal(fr!.sovereign_value, 0);
  assert.match(fr!.threshold_note, /informational only/);
});

test("failure_rate: at/above the sample floor evaluates a real pass when under the threshold", () => {
  const results = Array.from({ length: MIN_SAMPLES_FOR_STATISTICAL_PASS }, () => sovereignOnly(true));
  const report = baseReport({ crawl: results });
  const rows = deriveBenchmarkRows(report);
  const fr = rows.find((r) => r.capability === "crawl" && r.metric_name === "failure_rate");
  assert.ok(fr);
  assert.equal(fr!.passed, true, `0/${MIN_SAMPLES_FOR_STATISTICAL_PASS} failures should pass the <= ${FAILURE_RATE_MAX} threshold`);
  assert.equal(fr!.sovereign_value, 0);
});

test("failure_rate: at/above the sample floor evaluates a real fail when over the threshold", () => {
  const results = Array.from({ length: MIN_SAMPLES_FOR_STATISTICAL_PASS }, (_, i) => sovereignOnly(i >= 8));
  // 8 failures out of 10 = 80% failure rate, way over 5%.
  const report = baseReport({ crawl: results });
  const rows = deriveBenchmarkRows(report);
  const fr = rows.find((r) => r.capability === "crawl" && r.metric_name === "failure_rate");
  assert.equal(fr!.passed, false);
});

test("cost_per_successful_result: not evaluated when paid never ran — passed=null, not a false pass", () => {
  const report = baseReport({ crawl: [sovereignOnly(true)] });
  const rows = deriveBenchmarkRows(report);
  const cost = rows.find((r) => r.metric_name === "cost_per_successful_result" && r.capability === "crawl");
  assert.equal(cost, undefined, "no cost_per_successful_result row should be emitted at all when no paid comparison ran");
});

test("cost_per_successful_result: sovereign free vs paid billed — passes and records the real delta", () => {
  const report = baseReport({ crawl: [withPaid(true, true, { sovCost: 0, paidCost: 0.002 })] });
  const rows = deriveBenchmarkRows(report);
  const cost = rows.find((r) => r.metric_name === "cost_per_successful_result" && r.capability === "crawl");
  assert.ok(cost);
  assert.equal(cost!.passed, true);
  assert.equal(cost!.sovereign_value, 0);
  assert.equal(cost!.paid_value, 0.002);
  assert.equal(cost!.delta, 0.002);
});

test("cost_per_successful_result: sovereign more expensive than paid genuinely fails (no cost-fudging)", () => {
  const report = baseReport({ crawl: [withPaid(true, true, { sovCost: 0.05, paidCost: 0.002 })] });
  const rows = deriveBenchmarkRows(report);
  const cost = rows.find((r) => r.metric_name === "cost_per_successful_result" && r.capability === "crawl");
  assert.equal(cost!.passed, false);
});

test("backlink_referring_domain_overlap: only emitted when both sides ran, applies the Section 9 threshold as a proxy, and labels itself honestly as not a true correlation", () => {
  const report = baseReport({ backlinks: [withPaid(true, true, { overlap: 0.7 })] });
  const rows = deriveBenchmarkRows(report);
  const overlap = rows.find((r) => r.metric_name === "backlink_referring_domain_overlap");
  assert.ok(overlap);
  assert.equal(overlap!.passed, true);
  assert.equal(overlap!.delta, 0.7);
  assert.match(overlap!.threshold_note, /not the same statistic/);

  const reportLow = baseReport({ backlinks: [withPaid(true, true, { overlap: 0.4 })] });
  const rowsLow = deriveBenchmarkRows(reportLow);
  const overlapLow = rowsLow.find((r) => r.metric_name === "backlink_referring_domain_overlap");
  assert.equal(overlapLow!.passed, false, `0.4 < ${BACKLINK_OVERLAP_MIN} must fail`);
});

test("deriveBenchmarkRows never fabricates SERP comparison rows when paid side did not run", () => {
  const report = baseReport({ serp: [sovereignOnly(true, 0.001)] });
  const rows = deriveBenchmarkRows(report);
  assert.ok(
    !rows.some((r) => r.capability === "serp" && r.metric_name === "cost_per_successful_result"),
    "no paid SERP metric when paid side absent — must not invent a comparison row"
  );
  assert.ok(
    !rows.some((r) => r.metric_name === "serp_top10_overlap"),
    "must not invent serp_top10_overlap without paid overlap"
  );
  assert.ok(rows.some((r) => r.capability === "serp" && r.metric_name === "failure_rate"));
});

test("serp_top10_overlap: emitted when paid side ran with overlap, applies Section 9 80% threshold", () => {
  const report = baseReport({
    serp: [withPaid(true, true, { overlap: 0.85, sovCost: 0, paidCost: 0.002 })],
  });
  const rows = deriveBenchmarkRows(report);
  const overlap = rows.find((r) => r.metric_name === "serp_top10_overlap");
  assert.ok(overlap);
  assert.equal(overlap!.passed, true);
  assert.equal(overlap!.delta, 0.85);

  const reportLow = baseReport({
    serp: [withPaid(true, true, { overlap: 0.5, sovCost: 0, paidCost: 0.002 })],
  });
  const rowsLow = deriveBenchmarkRows(reportLow);
  assert.equal(rowsLow.find((r) => r.metric_name === "serp_top10_overlap")!.passed, false);
});

test("serp_position_delta: passed=null below sample floor; evaluates when n is sufficient", () => {
  const one = withPaid(true, true, { sovCost: 0, paidCost: 0.002 });
  one.sovereign.signal = { position: 3 };
  one.paid!.signal = { position: 4 };
  const report = baseReport({ serp: [one] });
  const rows = deriveBenchmarkRows(report);
  const delta = rows.find((r) => r.metric_name === "serp_position_delta");
  assert.ok(delta);
  assert.equal(delta!.passed, null, "n=1 below statistical floor");
  assert.equal(delta!.sovereign_value, 1);
});

test("persistBenchmarkRun inserts every derived row stamped with the report's finishedAt as run_at, and returns the real count", async () => {
  const insertedRows: Array<Record<string, unknown>> = [];
  const fakeSupabase = {
    from: (table: string) => {
      assert.equal(table, "benchmark_runs");
      return {
        insert: async (rows: Array<Record<string, unknown>>) => {
          insertedRows.push(...rows);
          return { error: null };
        },
      };
    },
  };
  const report = baseReport({
    crawl: [sovereignOnly(true), sovereignOnly(true)],
    backlinks: [withPaid(true, true, { overlap: 0.9 })],
  });
  const result = await persistBenchmarkRun(fakeSupabase as any, report);
  assert.equal(result.inserted, insertedRows.length);
  assert.ok(insertedRows.length > 0);
  for (const row of insertedRows) {
    assert.equal(row.run_at, report.finishedAt);
  }
});

test("persistBenchmarkRun throws (does not silently swallow) a real insert error", async () => {
  const fakeSupabase = {
    from: () => ({
      insert: async () => ({ error: { message: "db down" } }),
    }),
  };
  const report = baseReport({ crawl: [sovereignOnly(true), sovereignOnly(true)] });
  await assert.rejects(
    () => persistBenchmarkRun(fakeSupabase as any, report)
  );
});

test("persistBenchmarkRun is a no-op (zero inserts, no table call) when a report has no derivable rows", async () => {
  let fromCalled = false;
  const fakeSupabase = {
    from: () => {
      fromCalled = true;
      return { insert: async () => ({ error: null }) };
    },
  };
  const report = baseReport({});
  const result = await persistBenchmarkRun(fakeSupabase as any, report);
  assert.equal(result.inserted, 0);
  assert.equal(fromCalled, false);
});
