import { test } from "node:test";
import assert from "node:assert/strict";
import { formatJobCost, formatTokenCount, freshnessLabel } from "@/lib/utils";

test("formatJobCost: zero/negative/non-finite spend is honestly $0.00, never fabricated", () => {
  assert.equal(formatJobCost(0), "$0.00");
  assert.equal(formatJobCost(-1), "$0.00");
  assert.equal(formatJobCost(NaN), "$0.00");
  assert.equal(formatJobCost(Infinity), "$0.00");
});

test("formatJobCost: sub-cent spend shows 4dp instead of rounding to a misleading $0.00", () => {
  assert.equal(formatJobCost(0.0034), "$0.0034");
  assert.equal(formatJobCost(0.0001), "$0.0001");
});

test("formatJobCost: spend at or above a cent shows the usual 2dp", () => {
  assert.equal(formatJobCost(0.01), "$0.01");
  assert.equal(formatJobCost(1.5), "$1.50");
  assert.equal(formatJobCost(42), "$42.00");
});

test("formatTokenCount: zero/negative/non-finite is honestly 0 tokens", () => {
  assert.equal(formatTokenCount(0), "0 tokens");
  assert.equal(formatTokenCount(-5), "0 tokens");
  assert.equal(formatTokenCount(NaN), "0 tokens");
});

test("formatTokenCount: sub-1000 counts are shown exactly", () => {
  assert.equal(formatTokenCount(1), "1 tokens");
  assert.equal(formatTokenCount(850), "850 tokens");
});

test("formatTokenCount: 1000+ counts are compacted to k, trimming a trailing .0", () => {
  assert.equal(formatTokenCount(1000), "1k tokens");
  assert.equal(formatTokenCount(4200), "4.2k tokens");
  assert.equal(formatTokenCount(15750), "15.8k tokens");
});

test("freshnessLabel: buckets age into minutes/hours/days/months relative to a fixed 'now'", () => {
  const now = Date.parse("2026-07-07T12:00:00.000Z");
  assert.equal(freshnessLabel(new Date(now - 30_000).toISOString(), now), "just now");
  assert.equal(freshnessLabel(new Date(now - 5 * 60_000).toISOString(), now), "5m ago");
  assert.equal(freshnessLabel(new Date(now - 3 * 3_600_000).toISOString(), now), "3h ago");
  assert.equal(freshnessLabel(new Date(now - 10 * 86_400_000).toISOString(), now), "10d ago");
  assert.equal(freshnessLabel(new Date(now - 90 * 86_400_000).toISOString(), now), "3mo ago");
});

test("freshnessLabel: never lies with a negative or garbage age", () => {
  const now = Date.parse("2026-07-07T12:00:00.000Z");
  // captured_at in the future (clock skew) must not show a negative age.
  assert.equal(freshnessLabel(new Date(now + 60_000).toISOString(), now), "just now");
  assert.equal(freshnessLabel("not-a-date", now), "just now");
});
