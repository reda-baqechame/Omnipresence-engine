import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mineGscOpportunitiesFromInsights,
  mineGscOpportunitiesFromQueryRows,
  mineGscOpportunitiesFromRanks,
} from "../searchops-command-center.ts";
import {
  clusterStrikingDistanceByTargetUrl,
  enrichStrikingDistanceWithClusters,
  mineCannibalizationOpportunities,
} from "../searchops-gsc-miner.ts";
import { buildSearchOpsOpportunities } from "../searchops-opportunity-engine.ts";

test("mineGscOpportunitiesFromRanks uses position only — never invents impressions", () => {
  const ops = mineGscOpportunitiesFromRanks([
    { keyword: "roof repair", last_position: 8, is_striking_distance: true },
    { keyword: "skip me", last_position: null },
  ]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, "striking_distance");
  assert.equal(ops[0].impressions, 0);
  assert.equal(ops[0].position, 8);
});

test("mineGscOpportunitiesFromQueryRows mines high-impr low-CTR and striking distance", () => {
  const ops = mineGscOpportunitiesFromQueryRows([
    { query: "emergency roof", impressions: 500, clicks: 2, ctr: 0.004, position: 5 },
    { query: "near me roofing", impressions: 120, clicks: 8, ctr: 0.067, position: 12 },
    { query: "tiny", impressions: 10, clicks: 0, ctr: 0, position: 8 },
  ]);
  assert.ok(ops.some((o) => o.kind === "low_ctr" && o.queryOrUrl === "emergency roof"));
  assert.ok(ops.some((o) => o.kind === "striking_distance" && o.queryOrUrl === "near me roofing"));
  assert.ok(!ops.some((o) => o.queryOrUrl === "tiny"));
  assert.ok(ops.every((o) => o.impressions > 0));
});

test("mineGscOpportunitiesFromQueryRows returns empty when no measured rows", () => {
  assert.deepEqual(mineGscOpportunitiesFromQueryRows([]), []);
});

test("mineGscOpportunitiesFromInsights merges strike/low-ctr/decay without inventing volume", () => {
  const ops = mineGscOpportunitiesFromInsights({
    strikingDistance: [
      { query: "roof repair", impressions: 200, clicks: 10, ctr: 0.05, position: 8 },
    ],
    lowCtr: [{ query: "emergency roof", impressions: 400, clicks: 2, ctr: 0.005, position: 4 }],
    decay: [{ url: "https://example.com/old", currImpressions: 40, prevImpressions: 120 }],
  });
  assert.ok(ops.some((o) => o.kind === "striking_distance"));
  assert.ok(ops.some((o) => o.kind === "low_ctr"));
  assert.ok(ops.some((o) => o.kind === "decay"));
  assert.ok(ops.every((o) => o.impressions > 0));
});

test("rank_keywords cannibalization + page clusters flow into SearchOps opportunities", () => {
  const rankRows = [
    {
      keyword: "roof repair",
      last_position: 8,
      is_striking_distance: true,
      target_url: "https://ex.com/roof",
      cannibalization_urls: [
        { url: "https://ex.com/roof", position: 8 },
        { url: "https://ex.com/roof-alt", position: 14 },
      ],
    },
    {
      keyword: "roofing near me",
      last_position: 11,
      is_striking_distance: true,
      target_url: "https://ex.com/roof",
      cannibalization_urls: [],
    },
  ];
  const mined = mineGscOpportunitiesFromRanks(rankRows);
  const clusters = clusterStrikingDistanceByTargetUrl(
    rankRows,
    mined.map((o) => o.queryOrUrl)
  );
  const gscOpportunities = enrichStrikingDistanceWithClusters(mined, clusters, rankRows);
  const cannibal = mineCannibalizationOpportunities("p1", rankRows);
  const ops = buildSearchOpsOpportunities({
    projectId: "p1",
    gscConnected: true,
    gscOpportunities,
    extraOpportunities: cannibal,
    aiMentionRate: 0.5,
    aiSampleSize: 20,
    aiDataQuality: "measured",
  });

  assert.ok(ops.some((o) => o.id.includes("cannibalization:roof repair")));
  const strike = ops.find((o) => o.id.includes("gsc:strike:roof repair"));
  assert.ok(strike);
  const related = (strike!.evidence[0]?.value as { relatedQueries?: string[] } | undefined)
    ?.relatedQueries;
  assert.ok(related && related.length >= 2);
});
