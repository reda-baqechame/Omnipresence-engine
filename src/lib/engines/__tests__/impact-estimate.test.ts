import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateActionImpact } from "../impact-estimate.ts";

/**
 * Impact estimates power "what is this worth?" in the proof chain. They must be
 * conservative, clearly projections, monotonic in difficulty/influence, and
 * never model dollar value without volume data (no fabricated ROI).
 */

test("estimate is always flagged a projection, never a measured result", () => {
  const e = estimateActionImpact({ actionType: "content_publish", keywordVolume: 1000, cpc: 3 });
  assert.equal(e.is_projection, true);
});

test("no volume data → zero modeled clicks/value (no fabricated ROI)", () => {
  const e = estimateActionImpact({ actionType: "content_publish" });
  assert.equal(e.projected_monthly_clicks, 0);
  assert.equal(e.projected_value_usd, 0);
  assert.match(e.basis, /no volume data/);
});

test("higher difficulty dampens projected lift (monotonic)", () => {
  const easy = estimateActionImpact({ actionType: "content_publish", keywordVolume: 1000, difficulty: 10 });
  const hard = estimateActionImpact({ actionType: "content_publish", keywordVolume: 1000, difficulty: 90 });
  assert.ok(easy.projected_citation_lift_pp > hard.projected_citation_lift_pp);
});

test("higher source influence increases projected lift", () => {
  const low = estimateActionImpact({ actionType: "source_opportunity", influence: 10, keywordVolume: 1000 });
  const high = estimateActionImpact({ actionType: "source_opportunity", influence: 90, keywordVolume: 1000 });
  assert.ok(high.projected_citation_lift_pp > low.projected_citation_lift_pp);
});

test("confidence scales with how many real signals were provided", () => {
  assert.equal(estimateActionImpact({ actionType: "cms_patch" }).confidence, "low");
  assert.equal(estimateActionImpact({ actionType: "cms_patch", keywordVolume: 500 }).confidence, "medium");
  assert.equal(
    estimateActionImpact({ actionType: "cms_patch", keywordVolume: 500, cpc: 3 }).confidence,
    "high"
  );
});

test("value scales with volume × lift × CTR × CPC", () => {
  const e = estimateActionImpact({ actionType: "content_publish", keywordVolume: 10000, cpc: 5, difficulty: 0, influence: 100 });
  assert.ok(e.projected_value_usd > 0);
  // value == clicks × cpc
  assert.equal(e.projected_value_usd, Math.round(e.projected_monthly_clicks * 5));
});
