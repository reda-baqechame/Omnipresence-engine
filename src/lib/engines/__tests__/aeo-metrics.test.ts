import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateAeoMetrics, compareAeoRuns } from "../aeo-metrics.ts";
import type { VisibilityResult } from "@/types/database";

/**
 * AEO metrics back the AI-visibility share/citation numbers a client pays for.
 * These tests pin the honesty + math invariants: demo data never blends into
 * measured rates, every denominator is guarded (no NaN/Infinity), and rates are
 * real ratios of what was actually observed — never fabricated movement.
 */

function vis(overrides: Partial<VisibilityResult>): VisibilityResult {
  return {
    id: "r", run_id: "run", project_id: "p", engine: "chatgpt", prompt_text: "q",
    brand_mentioned: false, brand_cited: false, competitor_mentions: {}, competitor_citations: {},
    source_domains: [], cited_urls: [], data_source: "measured", ...overrides,
  } as VisibilityResult;
}

test("empty input yields finite zeros — never NaN/Infinity (no false data)", () => {
  const m = calculateAeoMetrics([], "MyBrand", []);
  for (const v of [m.shareOfVoice, m.citationRate, m.mentionRate, m.recommendationRate, m.measuredRate]) {
    assert.ok(Number.isFinite(v), `expected finite, got ${v}`);
  }
  assert.equal(m.shareOfVoice, 0);
  assert.equal(m.citationRate, 0);
  assert.equal(m.measuredRate, 0);
});

test("citationRate never divides by zero when there are no brand mentions", () => {
  const m = calculateAeoMetrics([vis({ brand_mentioned: false })], "MyBrand", []);
  assert.equal(m.citationRate, 0);
  assert.ok(Number.isFinite(m.citationRate));
});

test("demo rows never blend into measured metrics", () => {
  const results = [
    vis({ brand_mentioned: true, brand_cited: true, data_source: "measured" }),
    // A demo row that, if counted, would dilute the measured 100% mention rate.
    vis({ brand_mentioned: false, data_source: "simulated", engine: "gemini" }),
  ];
  const m = calculateAeoMetrics(results, "MyBrand", []);
  assert.equal(m.totalProbes, 1, "only the measured row is in the pool");
  assert.equal(m.mentionRate, 1, "measured mention rate must not be diluted by demo");
  assert.equal(m.measuredRate, 0.5, "measuredRate reflects 1 of 2 rows being measured");
});

test("falls back to demo pool ONLY when every row is demo (preview mode)", () => {
  const allDemo = [
    vis({ brand_mentioned: true, data_source: "simulated" }),
    vis({ brand_mentioned: false, data_source: "simulated" }),
  ];
  const m = calculateAeoMetrics(allDemo, "MyBrand", []);
  assert.equal(m.totalProbes, 2, "with no measured rows, the demo pool is used for preview");
  assert.equal(m.measuredRate, 0, "but measuredRate stays 0 — nothing was actually measured");
});

test("share of voice + competitor counts reflect real observed mentions", () => {
  const results = [
    vis({ brand_mentioned: true, competitor_mentions: { Acme: true } }),
    vis({ brand_mentioned: true, competitor_mentions: { Acme: true, Globex: true }, engine: "gemini" }),
  ];
  const m = calculateAeoMetrics(results, "MyBrand", ["Acme", "Globex"]);
  // brand mentions = 2, competitor mentions = 3 → SoV = 2/5
  assert.ok(Math.abs(m.shareOfVoice - 2 / 5) < 1e-9, `expected 0.4, got ${m.shareOfVoice}`);
  assert.equal(m.competitorShare.Acme, 2);
  assert.equal(m.competitorShare.Globex, 1);
  assert.equal(m.engineBreakdown.chatgpt.mentions, 1);
  assert.equal(m.engineBreakdown.gemini.mentions, 1);
  assert.equal(m.engineBreakdown.chatgpt.prompts, 1);
});

test("run-over-run delta is a real difference of measured rates", () => {
  const prev = [vis({ brand_mentioned: true, competitor_mentions: { Acme: true } })];
  const cur = [vis({ brand_mentioned: true }), vis({ brand_mentioned: true, engine: "gemini" })];
  const cmp = compareAeoRuns(cur, prev, "MyBrand", ["Acme"]);
  assert.ok(Number.isFinite(cmp.delta.shareOfVoice));
  // prev SoV = 1/2 = 0.5 (1 brand vs 1 competitor); cur SoV = 1.0 (no competitor) → +0.5
  assert.ok(cmp.delta.shareOfVoice > 0, "brand improved share vs previous run");
});
