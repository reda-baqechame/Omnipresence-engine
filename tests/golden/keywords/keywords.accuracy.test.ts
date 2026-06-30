import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  volumeBucket,
  extrapolateVolume,
  deriveGscAnchor,
  fromKnownVolume,
} from "../../../src/lib/engines/keyword-volume-math.ts";
import { classifyIntent, computeDifficulty } from "../../../src/lib/engines/keyword-difficulty-math.ts";
import { withinTolerance } from "../_lib/score.ts";

/**
 * Accuracy audit for the sovereign keyword volume + difficulty replacement
 * (keyword-volume-math.ts + keyword-difficulty-math.ts), our keyless
 * replacement for Semrush/Ahrefs volume & KD. This audits the deterministic
 * estimation math directly against known volume bands, intents, and ordering —
 * the part that must be correct regardless of which live SERP/Trends backend is
 * attached. Runs fully offline (no skips) so regressions fail CI immediately.
 */

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, "keywords.golden.json"), "utf8")) as {
  bucketBoundaries: Array<{ n: number; bucket: string }>;
  intentCases: Array<{ keyword: string; intent: string }>;
  extrapolation: {
    anchorVolume: number;
    anchorScore: number;
    cases: Array<{ keyword: string; score: number; expectedVolume: number; expectedBucket: string }>;
  };
};

test("volume buckets land on the correct Google log band at every boundary", () => {
  for (const c of golden.bucketBoundaries) {
    assert.equal(volumeBucket(c.n), c.bucket, `volumeBucket(${c.n}) should be ${c.bucket}`);
  }
});

test("intent classification matches known query intents", () => {
  for (const c of golden.intentCases) {
    assert.equal(classifyIntent(c.keyword), c.intent, `"${c.keyword}" should be ${c.intent}`);
  }
});

test("Trends extrapolation is proportional, ±30% banded, and correctly bucketed", () => {
  const { anchorVolume, anchorScore, cases } = golden.extrapolation;
  for (const c of cases) {
    const est = extrapolateVolume(c.keyword, c.score, anchorScore, anchorVolume);
    assert.equal(est.method, "trends_extrapolated");
    assert.ok(
      withinTolerance(est.volume ?? 0, c.expectedVolume, 0.02),
      `${c.keyword}: volume ${est.volume} not ≈ ${c.expectedVolume}`
    );
    assert.equal(est.range_bucket, c.expectedBucket);
    // ±30% band must straddle the midpoint.
    assert.ok((est.volume_low ?? 0) < (est.volume ?? 0) && (est.volume_high ?? 0) > (est.volume ?? 0));
  }
});

test("extrapolation is monotonic in Trends score (higher demand → higher volume)", () => {
  const a = extrapolateVolume("kw-a", 80, 100, 50000);
  const b = extrapolateVolume("kw-b", 40, 100, 50000);
  const c = extrapolateVolume("kw-c", 10, 100, 50000);
  assert.ok((a.volume ?? 0) > (b.volume ?? 0));
  assert.ok((b.volume ?? 0) > (c.volume ?? 0));
});

test("extrapolation degrades to relative-only when the anchor is unusable", () => {
  const est = extrapolateVolume("kw", 50, 0, 50000);
  assert.equal(est.method, "trends_relative");
  assert.equal(est.volume, undefined);
});

test("KD is monotonic in ranking-domain authority and never claims false-easy", () => {
  const easy = computeDifficulty(20, 0, false);
  const mid = computeDifficulty(55, 2, false);
  const hard = computeDifficulty(85, 6, true);
  assert.ok(easy < mid && mid < hard, `KD must increase with authority: ${easy} < ${mid} < ${hard}`);
  assert.ok(hard <= 100 && easy >= 1);
});

test("GSC anchor derivation picks the strongest top-10, high-impression query", () => {
  const anchor = deriveGscAnchor([
    { query: "small niche", impressions: 40, position: 3 }, // below impression floor
    { query: "ranked deep", impressions: 5000, position: 30 }, // not top-10
    { query: "best query", impressions: 1200, position: 4 }, // valid + strongest
    { query: "ok", impressions: 200, position: 2 }, // too short
  ]);
  assert.ok(anchor);
  assert.equal(anchor?.keyword, "best query");
  assert.equal(anchor?.volume, 1200); // top-10 → impressions ≈ volume
});

test("fromKnownVolume tags keyword_planner as high confidence with tight band", () => {
  const v = fromKnownVolume("crm software", 40000);
  assert.equal(v.confidence, "high");
  assert.equal(v.range_bucket, "10K–100K");
  assert.equal(v.volume_low, 32000);
  assert.equal(v.volume_high, 48000);
});
