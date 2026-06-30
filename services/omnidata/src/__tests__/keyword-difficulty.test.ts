import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeDifficulty } from "../engines/keyword-difficulty.js";

/**
 * KD correctness for the sovereign keyword-difficulty engine. `computeDifficulty`
 * is the pure core: when real domain authority is present (now sourced from the
 * Common Crawl webgraph, OpenPageRank-filled), KD must rise monotonically with
 * the authority of the ranking domains and never claim a false "easy" against an
 * authoritative SERP. Pure + offline so a regression fails CI immediately.
 */

function auth(map: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(map));
}

describe("computeDifficulty — authority-driven monotonicity", () => {
  it("rises monotonically with the authority of ranking domains", () => {
    const features: string[] = [];
    const easy = computeDifficulty({
      domains: ["a.com", "b.com", "c.com"],
      serpFeatureTypes: features,
      authorityMap: auth({ "a.com": 10, "b.com": 15, "c.com": 20 }),
    });
    const mid = computeDifficulty({
      domains: ["a.com", "b.com", "c.com"],
      serpFeatureTypes: features,
      authorityMap: auth({ "a.com": 45, "b.com": 50, "c.com": 55 }),
    });
    const hard = computeDifficulty({
      domains: ["a.com", "b.com", "c.com"],
      serpFeatureTypes: features,
      authorityMap: auth({ "a.com": 85, "b.com": 90, "c.com": 95 }),
    });
    assert.equal(easy.method, "ranking_authority");
    assert.ok(easy.difficulty < mid.difficulty, `${easy.difficulty} < ${mid.difficulty}`);
    assert.ok(mid.difficulty < hard.difficulty, `${mid.difficulty} < ${hard.difficulty}`);
    assert.ok(hard.difficulty <= 100 && easy.difficulty >= 1);
  });

  it("an AI Overview / featured snippet only increases difficulty (never lowers it)", () => {
    const base = computeDifficulty({
      domains: ["a.com", "b.com"],
      serpFeatureTypes: [],
      authorityMap: auth({ "a.com": 60, "b.com": 60 }),
    });
    const withAi = computeDifficulty({
      domains: ["a.com", "b.com"],
      serpFeatureTypes: ["ai_overview"],
      authorityMap: auth({ "a.com": 60, "b.com": 60 }),
    });
    const withSnippet = computeDifficulty({
      domains: ["a.com", "b.com"],
      serpFeatureTypes: ["featured_snippet"],
      authorityMap: auth({ "a.com": 60, "b.com": 60 }),
    });
    assert.ok(withAi.difficulty >= base.difficulty);
    assert.ok(withSnippet.difficulty >= base.difficulty);
  });

  it("falls back to the heuristic method (never crashes) when authority is absent", () => {
    const r = computeDifficulty({
      domains: ["wikipedia.org", "small-blog.net"],
      serpFeatureTypes: [],
      authorityMap: new Map(),
    });
    assert.equal(r.method, "heuristic");
    // A known-authority domain (wikipedia) must make it harder than two unknowns.
    const unknowns = computeDifficulty({
      domains: ["x.net", "y.net"],
      serpFeatureTypes: [],
      authorityMap: new Map(),
    });
    assert.ok(r.difficulty >= unknowns.difficulty);
    assert.ok(r.difficulty <= 100 && r.difficulty >= 0);
  });

  it("authority-driven KD outranks heuristic KD for the same authoritative SERP", () => {
    const domains = ["a.com", "b.com", "c.com"];
    const measured = computeDifficulty({
      domains,
      serpFeatureTypes: [],
      authorityMap: auth({ "a.com": 92, "b.com": 90, "c.com": 88 }),
    });
    assert.equal(measured.method, "ranking_authority");
    assert.ok(measured.difficulty >= 80, `authoritative SERP should be hard, got ${measured.difficulty}`);
  });
});
