import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeEntityProminence,
  wilsonInterval,
  calculateVisibilityMetrics,
  getResultDataSourceLabel,
} from "../visibility-scanner.ts";

test("wilsonInterval returns zero band for empty sample", () => {
  assert.deepEqual(wilsonInterval(0, 0), { low: 0, high: 0 });
});

test("wilsonInterval stays within 0..1 for small n", () => {
  const ci = wilsonInterval(1, 2);
  assert.ok(ci.low >= 0 && ci.high <= 1);
  assert.ok(ci.low <= ci.high);
});

test("computeEntityProminence ranks earlier mentions higher", () => {
  const text = "Acme is great. Competitor X also appears. Acme again.";
  const out = computeEntityProminence(text, ["Acme", "Competitor X"]);
  assert.ok((out.Acme?.score ?? 0) >= (out["Competitor X"]?.score ?? 0));
});

test("calculateVisibilityMetrics returns empty metrics for no results", () => {
  const m = calculateVisibilityMetrics([]);
  assert.equal(m.sampleSize, 0);
  assert.equal(m.mentionRate, 0);
});

test("calculateVisibilityMetrics counts measured mention rate", () => {
  const m = calculateVisibilityMetrics([
    {
      brand_mentioned: true,
      brand_cited: false,
      competitor_mentions: {},
      raw_response: {},
      data_source: "measured",
      recommendation_strength: null,
      answer_position: null,
      confidence: 0.9,
    },
    {
      brand_mentioned: false,
      brand_cited: false,
      competitor_mentions: {},
      raw_response: {},
      data_source: "measured",
      recommendation_strength: null,
      answer_position: null,
      confidence: 0.9,
    },
  ]);
  assert.equal(m.sampleSize, 2);
  assert.equal(m.mentionRate, 0.5);
});

test("getResultDataSourceLabel returns human-readable source labels", () => {
  const simulated = getResultDataSourceLabel({
    raw_response: { simulated: true },
  } as never);
  assert.equal(simulated, "Simulated");
});
