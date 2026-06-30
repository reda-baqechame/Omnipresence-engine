import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateShareOfVoice,
  compareShareOfVoice,
} from "../share-of-voice.ts";
import type { VisibilityResult } from "@/types/database";

/**
 * Share-of-Voice must reward being named FIRST/STRONGEST (the way AI buyers
 * actually act), count only measured answers (never demo/unavailable), and never
 * corrupt the leaderboard with NaN from malformed stored prominence.
 */

function vis(overrides: Partial<VisibilityResult>): VisibilityResult {
  return {
    id: "r", run_id: "run", project_id: "p", engine: "chatgpt", prompt_text: "q",
    brand_mentioned: false, brand_cited: false, competitor_mentions: {}, competitor_citations: {},
    source_domains: [], cited_urls: [], data_source: "measured", ...overrides,
  } as VisibilityResult;
}

test("prominence weighting: named first + strong beats named last", () => {
  const results = [
    vis({
      brand_mentioned: true,
      recommendation_strength: 1,
      answer_position: 1,
      competitor_mentions: { Acme: true },
      raw_response: { entity_prominence: { Acme: { strength: 0.5, position: 5 } } },
    }),
  ];
  const sov = calculateShareOfVoice(results, "MyBrand", ["Acme"]);
  assert.equal(sov.brandRank, 1, "brand named #1 strongly should lead");
  assert.ok((sov.brand?.shareOfVoice ?? 0) > 0.5);
  // Shares sum to ~1.
  const total = sov.leaderboard.reduce((s, e) => s + e.shareOfVoice, 0);
  assert.ok(Math.abs(total - 1) < 0.02, `shares should sum ~1, got ${total}`);
});

test("only measured answers count — demo/unavailable excluded from sampleSize", () => {
  const results = [
    vis({ brand_mentioned: true, data_source: "measured" }),
    vis({ brand_mentioned: true, data_source: "simulated" }),
    vis({ brand_mentioned: true, data_source: "unavailable" }),
  ];
  const sov = calculateShareOfVoice(results, "MyBrand", []);
  assert.equal(sov.sampleSize, 1, "only the measured row is counted");
});

test("malformed stored prominence never yields NaN in the leaderboard", () => {
  const results = [
    vis({
      brand_mentioned: true,
      raw_response: { entity_prominence: { MyBrand: { strength: "oops", position: null } } },
    }),
  ];
  const sov = calculateShareOfVoice(results, "MyBrand", []);
  for (const e of sov.leaderboard) {
    assert.ok(Number.isFinite(e.weightedScore), "weightedScore must be finite");
    assert.ok(Number.isFinite(e.shareOfVoice), "shareOfVoice must be finite");
  }
});

test("run-over-run comparison surfaces the biggest mover", () => {
  const prev = [vis({ brand_mentioned: true, competitor_mentions: { Acme: true } })];
  const cur = [
    vis({ brand_mentioned: true, recommendation_strength: 1, answer_position: 1 }),
    vis({ brand_mentioned: true, recommendation_strength: 1, answer_position: 1 }),
  ];
  const cmp = compareShareOfVoice(cur, prev, "MyBrand", ["Acme"]);
  assert.equal(cmp.hasComparison, true);
  assert.ok(cmp.brandDelta);
  // Brand went from sharing voice with Acme to dominating → positive delta.
  assert.ok((cmp.brandDelta?.delta ?? 0) > 0);
});

test("empty/no-measured input yields an honest empty comparison (no fabrication)", () => {
  const cmp = compareShareOfVoice([], [], "MyBrand", ["Acme"]);
  assert.equal(cmp.hasComparison, false);
  assert.equal(cmp.movers.length, 0);
});
