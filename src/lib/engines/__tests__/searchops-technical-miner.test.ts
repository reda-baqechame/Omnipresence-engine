import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertOpportunityQuality,
  isGenericSeoCopy,
} from "../searchops-opportunity-engine.ts";
import {
  mineCanonicalMismatchOpportunities,
  mineCwvOpportunities,
  mineInternalLinkOpportunities,
  mineSchemaGapOpportunities,
} from "../searchops-technical-miner.ts";

test("CWV empty history returns [] — never invents zero failed CWV", () => {
  assert.deepEqual(mineCwvOpportunities("p1", []), []);
});

test("CWV threshold breach produces measured field opportunity", () => {
  const ops = mineCwvOpportunities("p1", [
    { collected_on: "2026-07-01", lcp_ms: 3200, inp_ms: 120, cls: 0.05, data_source: "crux" },
  ]);
  const lcp = ops.find((o) => o.id.includes(":cwv:lcp"));
  assert.ok(lcp);
  assert.equal(lcp!.impactType, "measured");
  assert.ok(lcp!.evidence.every((e) => e.status === "measured"));
  assert.match(lcp!.diagnosis, /CrUX field/i);
  assert.equal(assertOpportunityQuality(lcp!).length, 0);
  assert.equal(isGenericSeoCopy(lcp!.title), false);
});

test("CWV regression vs previous row is flagged", () => {
  const ops = mineCwvOpportunities("p1", [
    { collected_on: "2026-07-08", lcp_ms: 2100, inp_ms: 250, cls: 0.04 },
    { collected_on: "2026-06-01", lcp_ms: 1800, inp_ms: 140, cls: 0.03 },
  ]);
  assert.ok(ops.some((o) => o.id.includes(":cwv:inp")));
});

test("schema gap at medium severity surfaces with model_knowledge impact + measured absence", () => {
  const ops = mineSchemaGapOpportunities("p1", [
    {
      id: "s1",
      severity: "medium",
      category: "schema",
      title: "Missing recommended schema types",
      description: "Found: Organization. Missing: FAQPage.",
      affected_url: "https://ex.com/",
      data_source: "measured",
      fix_recommendation: "Add FAQPage JSON-LD where FAQs exist.",
    },
  ]);
  assert.equal(ops.length, 1);
  const op = ops[0];
  assert.equal(op.impactType, "model_knowledge");
  assert.ok(op.evidence.some((e) => e.status === "measured" && e.source === "technical_findings"));
  assert.ok(op.evidence.some((e) => e.status === "model_knowledge"));
  assert.ok(!/boost rankings/i.test(op.recommendedAction));
  assert.equal(assertOpportunityQuality(op).length, 0);
});

test("schema gap with estimated data_quality does not claim measured absence", () => {
  const ops = mineSchemaGapOpportunities("p1", [
    {
      id: "s2",
      severity: "medium",
      category: "schema",
      title: "Missing FAQPage",
      data_quality: "estimated",
    },
  ]);
  assert.equal(ops.length, 1);
  assert.ok(ops[0].evidence.some((e) => e.label.includes("absence") && e.status === "estimated"));
  assert.ok(!ops[0].evidence.some((e) => e.label.includes("absence") && e.status === "measured"));
  assert.match(ops[0].diagnosis, /Estimated/i);
});

test("schema miner ignores non-schema findings", () => {
  assert.deepEqual(
    mineSchemaGapOpportunities("p1", [
      { id: "t1", severity: "high", category: "robots", title: "Site blocked", data_source: "measured" },
    ]),
    []
  );
});

test("internal links unavailable only when no crawl data", () => {
  const unavailable = mineInternalLinkOpportunities("p1", [], false);
  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0].impactType, "unavailable");
  assert.ok(unavailable[0].evidence.every((e) => e.status === "unavailable"));

  // Crawl exists but no opportunities → empty, not fake unavailable/zero claim.
  assert.deepEqual(mineInternalLinkOpportunities("p1", [], true), []);
});

test("internal link opportunity cites source and target URLs", () => {
  const ops = mineInternalLinkOpportunities(
    "p1",
    [
      {
        id: "il1",
        source_url: "https://ex.com/blog/a",
        target_url: "https://ex.com/services",
        anchor_suggestion: "roof repair services",
        relevance_score: 80,
        status: "identified",
      },
    ],
    true
  );
  assert.equal(ops.length, 1);
  assert.match(ops[0].recommendedAction, /blog\/a/);
  assert.match(ops[0].recommendedAction, /services/);
  assert.equal(ops[0].impactType, "measured");
  assert.equal(assertOpportunityQuality(ops[0]).length, 0);
});

test("canonical mismatch requires crawl evidence and real mismatch", () => {
  assert.deepEqual(mineCanonicalMismatchOpportunities("p1", []), []);
  assert.deepEqual(
    mineCanonicalMismatchOpportunities("p1", [
      { url: "https://ex.com/page", canonical: "https://ex.com/page" },
      { url: "https://ex.com/page/", canonical: "https://ex.com/page" },
    ]),
    []
  );

  const ops = mineCanonicalMismatchOpportunities("p1", [
    { url: "https://ex.com/old", canonical: "https://ex.com/new" },
  ]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].impactType, "measured");
  assert.ok(ops[0].evidence.some((e) => e.source === "crawl_pages"));
  assert.equal(assertOpportunityQuality(ops[0]).length, 0);
  assert.equal(isGenericSeoCopy(ops[0].title), false);
});
