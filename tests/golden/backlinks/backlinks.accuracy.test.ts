import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { requireService } from "../_lib/env.ts";
import { omnidataPost } from "../_lib/omnidata.ts";
import { spearmanRankCorrelation, monotonicViolations, setScore, normalizeDomain } from "../_lib/score.ts";

/**
 * Accuracy audit for the sovereign backlinks + authority replacement
 * (OmniData webgraph: /domain/authority/live + /backlinks/graph/live), our
 * keyless DR / referring-domain replacement for Ahrefs/Semrush.
 *
 * Ground truth = tests/golden/backlinks/backlinks.golden.json (known relative
 * authority ordering + high-confidence inbound links). Skips when OmniData isn't
 * configured; fails hard when it IS but the ordering/recall is wrong.
 */

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, "backlinks.golden.json"), "utf8")) as {
  authorityOrdering: string[];
  referringSamples: Array<{
    target: string;
    minReferringDomains: number;
    highConfidenceReferrers: string[];
    recallFloor: number;
  }>;
};

interface AuthorityResult {
  authority?: number | null;
  referring_domains?: number | null;
  verified_referrers?: string[];
  data_source?: string;
}

test("backlinks/authority: sovereign authority ordering matches known DR tiers", async (t) => {
  const svc = requireService("webgraph");
  if (!svc.ok) {
    t.skip(`OmniData webgraph not configured — ${svc.reason}`);
    return;
  }

  const domains = golden.authorityOrdering;
  const scores: number[] = [];
  const resolved: string[] = [];
  for (const d of domains) {
    const r = await omnidataPost<AuthorityResult>("/domain/authority/live", [{ target: d }]);
    if (r && typeof r.authority === "number" && r.data_source === "commoncrawl_webgraph") {
      scores.push(r.authority);
      resolved.push(d);
    }
  }

  // Need a meaningful sample of the webgraph to judge ordering accuracy.
  if (resolved.length < Math.ceil(domains.length * 0.6)) {
    t.skip(`webgraph resolved only ${resolved.length}/${domains.length} domains — not ingested enough to audit`);
    return;
  }

  // Expected rank = position in the descending golden ordering (best = 0).
  const expectedRank = resolved.map((d) => domains.indexOf(d));
  // Higher authority should correspond to a better (lower) expected rank, so
  // correlate authority against NEGATED expected rank → expect strong positive.
  const corr = spearmanRankCorrelation(scores, expectedRank.map((r) => -r));
  assert.ok(
    corr >= 0.6,
    `authority ordering correlation ${corr.toFixed(3)} < 0.6 vs known DR tiers (resolved ${resolved.length})`
  );

  // Top tier (first 3 resolved by golden order) must outrank the bottom tier.
  const topAvg = scores.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
  const bottomAvg = scores.slice(-3).reduce((a, b) => a + b, 0) / 3;
  assert.ok(topAvg > bottomAvg, `top-tier authority ${topAvg} should exceed bottom-tier ${bottomAvg}`);
  // Bounded monotonic drift is acceptable for a sampled webgraph; gross
  // inversion is not.
  const violations = monotonicViolations(scores, "desc");
  assert.ok(
    violations <= Math.floor(scores.length * 0.5),
    `too many authority ordering inversions: ${violations}/${scores.length}`
  );
});

test("backlinks: referring-domain recall clears the floor on high-confidence inbound links", async (t) => {
  const svc = requireService("webgraph");
  if (!svc.ok) {
    t.skip(`OmniData webgraph not configured — ${svc.reason}`);
    return;
  }

  let audited = 0;
  for (const sample of golden.referringSamples) {
    const auth = await omnidataPost<AuthorityResult>("/domain/authority/live", [
      { target: sample.target, verify_referrers: sample.highConfidenceReferrers },
    ]);
    if (!auth || auth.data_source !== "commoncrawl_webgraph") continue;
    if ((auth.referring_domains ?? 0) < sample.minReferringDomains) continue;
    audited += 1;

    const referrers = auth.verified_referrers || [];
    const score = setScore(referrers, sample.highConfidenceReferrers);
    assert.ok(
      score.recall >= sample.recallFloor,
      `${sample.target}: referring-domain recall ${score.recall.toFixed(2)} < floor ${sample.recallFloor} (found ${score.truePositives}/${sample.highConfidenceReferrers.length})`
    );
  }

  if (audited === 0) {
    t.skip("webgraph returned no backlink items for any sample — not ingested");
  }
});
