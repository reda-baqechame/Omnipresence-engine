import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertOpportunityQuality,
  isGenericSeoCopy,
} from "../searchops-opportunity-engine.ts";
import {
  clusterStrikingDistanceByTargetUrl,
  enrichStrikingDistanceWithClusters,
  mineCannibalizationOpportunities,
} from "../searchops-gsc-miner.ts";

test("cannibalization requires 2+ measured URLs — empty/absent yields no fake zero", () => {
  assert.deepEqual(mineCannibalizationOpportunities("p1", []), []);
  assert.deepEqual(
    mineCannibalizationOpportunities("p1", [
      { keyword: "roof repair", cannibalization_urls: [], last_position: 5 },
      { keyword: "solo", cannibalization_urls: [{ url: "https://ex.com/a", position: 3 }], last_position: 3 },
      { keyword: "missing", cannibalization_urls: null, last_position: 4 },
    ]),
    []
  );
});

test("cannibalization generates measured opportunity with evidence and no generic copy", () => {
  const ops = mineCannibalizationOpportunities("p1", [
    {
      keyword: "emergency roofing",
      last_position: 4,
      cannibalization_urls: [
        { url: "https://ex.com/a", position: 4 },
        { url: "https://ex.com/b", position: 9 },
        { url: "https://ex.com/c", position: 12 },
      ],
    },
  ]);
  assert.equal(ops.length, 1);
  const op = ops[0];
  assert.equal(op.category, "serp");
  assert.equal(op.impactType, "measured");
  assert.match(op.title, /emergency roofing/);
  assert.match(op.title, /3 URLs/);
  assert.ok(op.evidence.some((e) => e.source === "rank_snapshots" && e.status === "measured"));
  assert.equal(assertOpportunityQuality(op).length, 0);
  assert.equal(isGenericSeoCopy(op.title), false);
  assert.equal(isGenericSeoCopy(op.recommendedAction), false);
  assert.ok(op.verificationPlan.includes("cannibalization_urls"));
});

test("cannibalization output is deterministic", () => {
  const rows = [
    {
      keyword: "b query",
      cannibalization_urls: [
        { url: "https://ex.com/1", position: 5 },
        { url: "https://ex.com/2", position: 8 },
      ],
    },
    {
      keyword: "a query",
      cannibalization_urls: [
        { url: "https://ex.com/3", position: 2 },
        { url: "https://ex.com/4", position: 6 },
      ],
    },
  ];
  const a = mineCannibalizationOpportunities("p1", rows).map((o) => o.id);
  const b = mineCannibalizationOpportunities("p1", rows).map((o) => o.id);
  assert.deepEqual(a, b);
  assert.ok(a[0].includes("a query") || a[0] < a[1]);
});

test("clusterStrikingDistanceByTargetUrl only keeps clusters with 2+ queries", () => {
  const clusters = clusterStrikingDistanceByTargetUrl(
    [
      { keyword: "q1", target_url: "https://ex.com/page", last_position: 8, is_striking_distance: true },
      { keyword: "q2", target_url: "https://ex.com/page", last_position: 10, is_striking_distance: true },
      { keyword: "solo", target_url: "https://ex.com/other", last_position: 7, is_striking_distance: true },
    ],
    ["q1", "q2", "solo"]
  );
  assert.equal(clusters.size, 1);
  const related = clusters.get("https://ex.com/page");
  assert.ok(related);
  assert.deepEqual(related, ["q1", "q2"]);
});

test("clusterStrikingDistanceByTargetUrl never cites queries outside the mine list", () => {
  const clusters = clusterStrikingDistanceByTargetUrl(
    [
      { keyword: "q1", target_url: "https://ex.com/page", last_position: 8, is_striking_distance: true },
      { keyword: "q2", target_url: "https://ex.com/page", last_position: 10, is_striking_distance: true },
      { keyword: "sliced-out", target_url: "https://ex.com/page", last_position: 12, is_striking_distance: true },
    ],
    ["q1", "q2"] // sliced-out was not in mined opportunity list
  );
  assert.deepEqual(clusters.get("https://ex.com/page"), ["q1", "q2"]);
});

test("enrichStrikingDistanceWithClusters attaches relatedQueries when cluster exists", () => {
  const clusters = clusterStrikingDistanceByTargetUrl(
    [
      { keyword: "alpha", target_url: "https://ex.com/p", last_position: 8 },
      { keyword: "beta", target_url: "https://ex.com/p", last_position: 11 },
    ],
    ["alpha", "beta"]
  );
  const enriched = enrichStrikingDistanceWithClusters(
    [
      { kind: "striking_distance" as const, queryOrUrl: "alpha", impressions: 0, position: 8 },
      { kind: "low_ctr" as const, queryOrUrl: "other", impressions: 100, position: 3 },
    ],
    clusters,
    [
      { keyword: "alpha", target_url: "https://ex.com/p" },
      { keyword: "beta", target_url: "https://ex.com/p" },
    ]
  );
  assert.deepEqual(enriched[0].relatedQueries, ["alpha", "beta"]);
  assert.equal(enriched[1].relatedQueries, undefined);
});
