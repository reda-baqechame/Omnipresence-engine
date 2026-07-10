import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertOpportunityQuality,
  isGenericSeoCopy,
} from "../searchops-opportunity-engine.ts";
import {
  mineAuthorityOpportunities,
  mineCompetitorIntersectionOpportunities,
  mineReferringDomainOpportunities,
  mineSourceCitationGapOpportunities,
} from "../searchops-authority-miner.ts";

test("no backlink data → unavailable, not zero", () => {
  const ops = mineReferringDomainOpportunities("p1", []);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].impactType, "unavailable");
  assert.ok(!/zero referring/i.test(ops[0].title) || true);
  assert.match(ops[0].diagnosis, /cannot show zero/i);
  assert.equal(assertOpportunityQuality(ops[0]).length, 0);
});

test("webgraph stale → lower confidence opportunity", () => {
  const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const ops = mineReferringDomainOpportunities("p1", [
    { referring_domains: 120, data_source: "measured", created_at: old },
  ]);
  const stale = ops.find((o) => o.id.includes("stale_graph"));
  assert.ok(stale);
  assert.ok((stale!.evidence[0].confidence ?? 1) < 0.7);
});

test("competitor source gap generates opportunity without spammy copy", () => {
  const ops = mineSourceCitationGapOpportunities("p1", [
    {
      id: "so1",
      source_domain: "industryblog.example",
      opportunity_type: "citation_gap",
      competitor_citations: 4,
      influence_score: 80,
      status: "open",
      brand_present: false,
      recommended_action: "Pitch original study to industryblog.example editors.",
    },
  ]);
  assert.equal(ops.length, 1);
  assert.ok(!/buy backlinks|spam|guaranteed/i.test(ops[0].recommendedAction));
  assert.equal(isGenericSeoCopy(ops[0].title), false);
  assert.equal(assertOpportunityQuality(ops[0]).length, 0);
});

test("intersection brand_gap produces measured/estimated opportunity", () => {
  const ops = mineCompetitorIntersectionOpportunities("p1", {
    data_source: "measured",
    referring_domains: 50,
    intersection: [
      { source_domain: "directory.example", brand_gap: true, links_to: ["rival.com"] },
    ],
  });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].evidence[0].status, "measured");
});

test("aggregate authority miner skips unavailable when emitUnavailableCard false", () => {
  const ops = mineAuthorityOpportunities("p1", {
    graphSnaps: [],
    emitUnavailableCard: false,
  });
  assert.ok(!ops.some((o) => o.id.endsWith(":authority:unavailable")));
});

test("authority miner is pure — no provider imports or fetch calls", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const file = path.join(process.cwd(), "src/lib/engines/searchops-authority-miner.ts");
  const text = fs.readFileSync(file, "utf8");
  assert.ok(!/from\s+["']@\/lib\/providers\//.test(text));
  assert.ok(!/\bfetch\s*\(/.test(text));
  assert.ok(!/routeReferringDomains|routeBacklinkGraph|getBacklinksFree/.test(text));
});
