import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mineGscOpportunitiesFromQueryRows,
  mineGscOpportunitiesFromRanks,
} from "../searchops-command-center.ts";

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
