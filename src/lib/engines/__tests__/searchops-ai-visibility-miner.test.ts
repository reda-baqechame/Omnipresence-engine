import { test } from "node:test";
import assert from "node:assert/strict";
import type { VisibilityResult } from "../../../types/database.ts";
import {
  assertOpportunityQuality,
  isGenericSeoCopy,
} from "../searchops-opportunity-engine.ts";
import {
  mineAiVisibilityOpportunities,
  mineAnswerGapOpportunities,
  mineMissingCitationOpportunities,
  minePromptClusterOpportunities,
} from "../searchops-ai-visibility-miner.ts";

function probe(partial: Partial<VisibilityResult> & { prompt_text: string }): VisibilityResult {
  return {
    id: partial.id || Math.random().toString(36).slice(2),
    project_id: "p1",
    run_id: "r1",
    engine: partial.engine || "chatgpt",
    prompt_text: partial.prompt_text,
    brand_mentioned: partial.brand_mentioned ?? false,
    brand_cited: partial.brand_cited ?? false,
    competitor_mentions: partial.competitor_mentions ?? {},
    competitor_citations: partial.competitor_citations ?? {},
    source_domains: partial.source_domains ?? [],
    data_source: partial.data_source ?? "measured",
    created_at: new Date().toISOString(),
    ...partial,
  } as VisibilityResult;
}

test("low sample does not invent measured cluster opportunities", () => {
  const ops = minePromptClusterOpportunities("p1", [
    probe({ prompt_text: "how to buy roofing", brand_mentioned: false }),
    probe({ prompt_text: "best roof price", brand_mentioned: false }),
  ]);
  assert.deepEqual(ops, []);
});

test("weak cluster with enough measured probes creates opportunity", () => {
  const results = Array.from({ length: 6 }, (_, i) =>
    probe({
      prompt_text: `how to choose roofing ${i}`,
      brand_mentioned: i === 0,
      competitor_mentions: { Rival: true },
    })
  );
  const ops = minePromptClusterOpportunities("p1", results, { ratesReliable: false });
  assert.ok(ops.length >= 1);
  assert.equal(ops[0].impactType, "measured");
  assert.ok(ops[0].limitations.some((l) => /below the headline/i.test(l)));
  assert.equal(assertOpportunityQuality(ops[0]).length, 0);
  assert.equal(isGenericSeoCopy(ops[0].title), false);
});

test("competitor cited / brand absent creates evidence-backed opportunity", () => {
  const results = [
    probe({
      prompt_text: "best emergency roofing",
      brand_mentioned: false,
      brand_cited: false,
      competitor_mentions: { RivalCo: true },
      source_domains: ["reviewsite.example", "brand.com"],
    }),
    probe({
      prompt_text: "roof repair quotes",
      brand_mentioned: false,
      brand_cited: false,
      competitor_citations: { RivalCo: true },
      source_domains: ["reviewsite.example"],
    }),
  ];
  const ops = mineMissingCitationOpportunities("p1", results, "brand.com");
  assert.ok(ops.some((o) => o.title.includes("reviewsite.example")));
  assert.ok(ops.every((o) => o.evidence.some((e) => e.status === "measured")));
  assert.ok(!ops.some((o) => /guaranteed/i.test(o.recommendedAction)));
});

test("citation missing without third-party sources returns empty (not fake)", () => {
  const ops = mineMissingCitationOpportunities(
    "p1",
    [probe({ prompt_text: "alone", brand_mentioned: false, source_domains: [] })],
    "brand.com"
  );
  assert.deepEqual(ops, []);
});

test("answer gap creates content-specific action without generic SEO fluff", () => {
  const ops = mineAnswerGapOpportunities("p1", [
    probe({
      prompt_text: "what causes roof leaks",
      brand_mentioned: false,
      competitor_mentions: { Rival: true },
    }),
  ]);
  assert.ok(ops.length >= 1);
  assert.match(ops[0].recommendedAction, /answer-first/i);
  assert.equal(isGenericSeoCopy(ops[0].title), false);
});

test("aggregate miner is deterministic and dedupes", () => {
  const results = Array.from({ length: 8 }, (_, i) =>
    probe({
      prompt_text: `buy roofing near me ${i % 3}`,
      brand_mentioned: false,
      competitor_mentions: { Rival: true },
      source_domains: ["news.example"],
    })
  );
  const a = mineAiVisibilityOpportunities("p1", results, "brand.com").map((o) => o.id);
  const b = mineAiVisibilityOpportunities("p1", results, "brand.com").map((o) => o.id);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});
