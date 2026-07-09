import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeBenchmarkRuns,
  PROMOTION_STREAK_DAYS,
  type BenchmarkRunRecord,
} from "../benchmark-dashboard.ts";

/**
 * Patch H parity dashboard: pins the consecutive-day streak math (the exact
 * bar Patch J needs before it may demote DataForSEO for a capability) and
 * the honesty rule that a metric with no rows, a broken streak, or a
 * not-evaluated day is never reported as promotion-ready.
 */

function row(overrides: Partial<BenchmarkRunRecord> & { run_at: string }): BenchmarkRunRecord {
  return {
    id: `id-${Math.random()}`,
    capability: "crawl",
    metric_name: "failure_rate",
    sovereign_provider: "sovereign-x",
    paid_provider: "paid-vendor",
    dataset_ref: "dataset-1",
    sovereign_value: 0,
    paid_value: null,
    delta: null,
    passed: true,
    threshold_note: "note",
    ...overrides,
  };
}

/** Fixed UTC anchor so streak math never flakes across real-world midnight boundaries. */
const STREAK_ANCHOR_UTC = new Date("2026-06-15T12:00:00.000Z");

function daysAgoIso(days: number): string {
  return new Date(STREAK_ANCHOR_UTC.getTime() - days * 86_400_000).toISOString();
}

test("summarizeBenchmarkRuns groups rows by capability + metric independently", () => {
  const rows: BenchmarkRunRecord[] = [
    row({ capability: "crawl", metric_name: "failure_rate", run_at: daysAgoIso(0), passed: true }),
    row({ capability: "backlinks", metric_name: "backlink_referring_domain_overlap", run_at: daysAgoIso(0), passed: false }),
  ];
  const groups = summarizeBenchmarkRuns(rows);
  assert.equal(groups.length, 2);
  const crawl = groups.find((g) => g.capability === "crawl");
  const backlinks = groups.find((g) => g.capability === "backlinks");
  assert.equal(crawl!.latest.passed, true);
  assert.equal(backlinks!.latest.passed, false);
});

test("an unbroken run of N consecutive passing calendar days reports a streak of exactly N", () => {
  const rows: BenchmarkRunRecord[] = Array.from({ length: 5 }, (_, i) =>
    row({ run_at: daysAgoIso(i), passed: true })
  );
  const [group] = summarizeBenchmarkRuns(rows);
  assert.equal(group.consecutivePassDays, 5);
  assert.equal(group.totalDaysObserved, 5);
});

test("a single failing day in the middle of the history caps the streak at the most-recent unbroken run", () => {
  const rows: BenchmarkRunRecord[] = [
    row({ run_at: daysAgoIso(0), passed: true }),
    row({ run_at: daysAgoIso(1), passed: true }),
    row({ run_at: daysAgoIso(2), passed: false }),
    row({ run_at: daysAgoIso(3), passed: true }),
    row({ run_at: daysAgoIso(4), passed: true }),
  ];
  const [group] = summarizeBenchmarkRuns(rows);
  assert.equal(group.consecutivePassDays, 2, "streak must stop at the failing day, not skip over it");
});

test("a not-evaluated (passed=null) day also breaks the streak — insufficient sample never counts as a pass", () => {
  const rows: BenchmarkRunRecord[] = [
    row({ run_at: daysAgoIso(0), passed: true }),
    row({ run_at: daysAgoIso(1), passed: null }),
    row({ run_at: daysAgoIso(2), passed: true }),
  ];
  const [group] = summarizeBenchmarkRuns(rows);
  assert.equal(group.consecutivePassDays, 1);
});

test("a missing calendar day (cron didn't run) breaks the streak even if both surrounding days passed", () => {
  const rows: BenchmarkRunRecord[] = [
    row({ run_at: daysAgoIso(0), passed: true }),
    // day -1 is missing entirely
    row({ run_at: daysAgoIso(2), passed: true }),
  ];
  const [group] = summarizeBenchmarkRuns(rows);
  assert.equal(group.consecutivePassDays, 1, "a gap day must not be silently bridged");
});

test("same-day re-runs collapse to the latest run for that day and count as a single day of streak", () => {
  const day = "2026-06-15";
  const rows: BenchmarkRunRecord[] = [
    row({ run_at: `${day}T08:00:00.000Z`, passed: false }),
    row({ run_at: `${day}T20:00:00.000Z`, passed: true }),
  ];
  const [group] = summarizeBenchmarkRuns(rows);
  assert.equal(group.totalDaysObserved, 1);
  assert.equal(group.latest.passed, true, "the later same-day run must win, not the earlier failing one");
  assert.equal(group.consecutivePassDays, 1);
});

test(`promotionReady is only true once the streak reaches PROMOTION_STREAK_DAYS (${PROMOTION_STREAK_DAYS})`, () => {
  const shortRun: BenchmarkRunRecord[] = Array.from({ length: PROMOTION_STREAK_DAYS - 1 }, (_, i) =>
    row({ run_at: daysAgoIso(i), passed: true })
  );
  const [shortGroup] = summarizeBenchmarkRuns(shortRun);
  assert.equal(shortGroup.promotionReady, false);

  const fullRun: BenchmarkRunRecord[] = Array.from({ length: PROMOTION_STREAK_DAYS }, (_, i) =>
    row({ run_at: daysAgoIso(i), passed: true })
  );
  const [fullGroup] = summarizeBenchmarkRuns(fullRun);
  assert.equal(fullGroup.promotionReady, true);
});

test("a metric that has never passed is never promotion-ready regardless of how many rows exist", () => {
  const rows: BenchmarkRunRecord[] = Array.from({ length: 40 }, (_, i) =>
    row({ run_at: daysAgoIso(i), passed: false })
  );
  const [group] = summarizeBenchmarkRuns(rows);
  assert.equal(group.consecutivePassDays, 0);
  assert.equal(group.promotionReady, false);
});

test("summarizeBenchmarkRuns returns an empty array for no rows — never invents a group", () => {
  assert.deepEqual(summarizeBenchmarkRuns([]), []);
});

test("groups are sorted deterministically by capability then metric name", () => {
  const rows: BenchmarkRunRecord[] = [
    row({ capability: "serp", metric_name: "position_delta", run_at: daysAgoIso(0) }),
    row({ capability: "backlinks", metric_name: "backlink_referring_domain_overlap", run_at: daysAgoIso(0) }),
    row({ capability: "backlinks", metric_name: "failure_rate", run_at: daysAgoIso(0) }),
  ];
  const groups = summarizeBenchmarkRuns(rows);
  assert.deepEqual(
    groups.map((g) => `${g.capability}::${g.metricName}`),
    ["backlinks::backlink_referring_domain_overlap", "backlinks::failure_rate", "serp::position_delta"]
  );
});
