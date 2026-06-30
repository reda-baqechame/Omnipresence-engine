import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rankFastestPath,
  buildWinnableSurfaces,
  computeFastestPath,
  type WinnableSurface,
} from "../fastest-path.ts";

/**
 * Unit tests for the fastest-path-to-visibility engine (Wave T2). The ordering
 * must reward speed + winnability + impact and penalize effort, and the
 * candidate builder must only surface genuinely winnable-soon work for a new
 * brand (e.g. drop high-difficulty long-tail terms).
 */

test("ranking prefers a fast, winnable, low-effort surface over a slow hard one", () => {
  const surfaces: WinnableSurface[] = [
    {
      id: "fast",
      type: "schema_markup",
      title: "Schema",
      timeToImpactDays: 5,
      effort: "low",
      winnability: 0.95,
      impact: 50,
      rationale: "",
      action: "schema_deploy",
    },
    {
      id: "slow",
      type: "ai_cited_source",
      title: "High authority source",
      timeToImpactDays: 80,
      effort: "high",
      winnability: 0.2,
      impact: 75,
      rationale: "",
      action: "outreach",
    },
  ];
  const ranked = rankFastestPath(surfaces);
  assert.equal(ranked[0].id, "fast");
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 2);
  assert.ok(ranked[0].score > ranked[1].score);
});

test("builder drops long-tail terms that are too hard for a new brand", () => {
  const surfaces = buildWinnableSurfaces({
    domainAuthority: 10,
    longTailKeywords: [
      { keyword: "easy term", difficulty: 20, volume: 200 },
      { keyword: "hard term", difficulty: 80, volume: 5000 },
    ],
  });
  const longTail = surfaces.filter((s) => s.type === "long_tail_content");
  assert.equal(longTail.length, 1);
  assert.match(longTail[0].title, /easy term/);
});

test("new brand (low authority) gets a schema-markup quick win", () => {
  const newBrand = buildWinnableSurfaces({ domainAuthority: 5 });
  assert.ok(newBrand.some((s) => s.type === "schema_markup"));
  const established = buildWinnableSurfaces({ domainAuthority: 85 });
  assert.ok(!established.some((s) => s.type === "schema_markup"));
});

test("local brand gets a fast GBP surface ranked highly", () => {
  const plan = computeFastestPath({ isLocal: true, hasGbp: false }, { limit: 5 });
  const gbp = plan.find((p) => p.type === "local_gbp");
  assert.ok(gbp);
  assert.ok(gbp!.rank <= 3);
});

test("limit caps the returned plan length", () => {
  const plan = computeFastestPath(
    {
      competitorCount: 2,
      isLocal: true,
      domainAuthority: 10,
      longTailKeywords: [{ keyword: "a", difficulty: 10 }, { keyword: "b", difficulty: 15 }],
      missingDirectories: [{ name: "G2", surface: "g2" }, { name: "Yelp", surface: "yelp" }],
    },
    { limit: 3 }
  );
  assert.equal(plan.length, 3);
});
