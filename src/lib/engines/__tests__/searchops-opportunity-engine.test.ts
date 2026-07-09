import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertOpportunityQuality,
  buildSearchOpsOpportunities,
  isGenericSeoCopy,
} from "../searchops-opportunity-engine.ts";

test("isGenericSeoCopy rejects marketing fluff", () => {
  assert.equal(isGenericSeoCopy("Improve SEO"), true);
  assert.equal(isGenericSeoCopy("Boost rankings"), true);
  assert.equal(isGenericSeoCopy("AI mention rate is 4.2% across 12 grounded probes"), false);
});

test("unavailable AI data does not invent a measured mention rate opportunity", () => {
  const ops = buildSearchOpsOpportunities({
    projectId: "p1",
    aiMentionRate: null,
    aiSampleSize: 0,
    aiDataQuality: "unavailable",
  });
  const ai = ops.filter((o) => o.category === "ai_visibility");
  assert.ok(ai.length >= 1);
  assert.ok(ai.every((o) => o.impactType === "unavailable" || o.evidence.some((e) => e.status === "unavailable")));
  assert.ok(!ai.some((o) => o.title.includes("0%") && o.impactType === "measured"));
});

test("measured low AI mention rate produces evidence-backed opportunity with verificationPlan", () => {
  const ops = buildSearchOpsOpportunities({
    projectId: "p1",
    aiMentionRate: 0.04,
    aiSampleSize: 20,
    aiDataQuality: "measured",
  });
  const hit = ops.find((o) => o.id.includes("low_mention"));
  assert.ok(hit);
  assert.equal(hit!.impactType, "measured");
  assert.ok(hit!.verificationPlan.length > 10);
  assert.equal(assertOpportunityQuality(hit!).length, 0);
  assert.ok(hit!.evidence.some((e) => e.status === "measured"));
});

test("estimated impact is labeled when coverage is model_knowledge", () => {
  const ops = buildSearchOpsOpportunities({
    projectId: "p1",
    aiMentionRate: 0.5,
    aiSampleSize: 20,
    aiDataQuality: "measured",
    coverageGaps: [
      {
        id: "c1",
        title: "Wikipedia entity page",
        is_present: false,
        data_quality: "model_knowledge",
      },
    ],
  });
  const cov = ops.find((o) => o.category === "content");
  assert.ok(cov);
  assert.equal(cov!.impactType, "model_knowledge");
});

test("priority scoring is deterministic across runs", () => {
  const input = {
    projectId: "p1",
    aiMentionRate: 0.02,
    aiSampleSize: 15,
    aiDataQuality: "measured" as const,
    technicalFindings: [
      { id: "t1", severity: "critical", title: "Missing canonical on product pages", data_quality: "measured" as const },
      { id: "t2", severity: "high", title: "Broken internal link cluster", data_quality: "measured" as const },
    ],
  };
  const a = buildSearchOpsOpportunities(input).map((o) => o.id);
  const b = buildSearchOpsOpportunities(input).map((o) => o.id);
  assert.deepEqual(a, b);
  const crit = buildSearchOpsOpportunities(input).find((o) => o.priority === "critical");
  assert.ok(crit);
});

test("generic title findings are rejected", () => {
  const ops = buildSearchOpsOpportunities({
    projectId: "p1",
    aiMentionRate: 0.5,
    aiSampleSize: 20,
    aiDataQuality: "measured",
    technicalFindings: [{ id: "t1", severity: "high", title: "Improve SEO", data_quality: "measured" }],
  });
  assert.ok(!ops.some((o) => /improve seo/i.test(o.title)));
});

test("GSC disconnected yields unavailable opportunity, not fake CTR", () => {
  const ops = buildSearchOpsOpportunities({
    projectId: "p1",
    aiMentionRate: 0.5,
    aiSampleSize: 20,
    aiDataQuality: "measured",
    gscConnected: false,
  });
  const gsc = ops.find((o) => o.id.includes("gsc:disconnected"));
  assert.ok(gsc);
  assert.equal(gsc!.impactType, "unavailable");
  assert.ok(!gsc!.title.toLowerCase().includes("ctr 0"));
});

test("unreliable AI probes do not claim zero probes while sampleSize > 0", () => {
  const ops = buildSearchOpsOpportunities({
    projectId: "p1",
    aiMentionRate: null,
    aiSampleSize: 4,
    aiDataQuality: "unavailable",
  });
  const ai = ops.find((o) => o.id.includes("ai_visibility:unavailable"));
  assert.ok(ai);
  assert.match(ai!.diagnosis, /4 grounded/);
  assert.ok(!/No grounded AI-visibility probes are available/i.test(ai!.diagnosis));
  assert.equal(ai!.impactType, "unavailable");
});

test("extraOpportunities pass through quality pipeline and dedupe by id", () => {
  const shared = {
    id: "p1:cannibalization:roof",
    projectId: "p1",
    category: "serp" as const,
    title: "Query cannibalization: “roof” split across 2 URLs",
    diagnosis: "Measured SERP check shows 2 brand URLs.",
    evidence: [
      {
        label: "Brand URLs",
        source: "rank_snapshots",
        status: "measured" as const,
        confidence: 0.8,
      },
    ],
    priority: "medium" as const,
    impactType: "measured" as const,
    effort: "medium" as const,
    recommendedAction: "Consolidate toward the strongest URL and re-check rank snapshot.",
    verificationPlan: "Re-run rank check; cannibalization_urls should drop to 0 or 1.",
    limitations: ["SERP snapshot can vary."],
  };
  const ops = buildSearchOpsOpportunities({
    projectId: "p1",
    aiMentionRate: 0.5,
    aiSampleSize: 20,
    aiDataQuality: "measured",
    extraOpportunities: [shared, { ...shared, title: "Duplicate should be dropped by id" }],
  });
  const hits = ops.filter((o) => o.id === shared.id);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, shared.title);
});

test("low CTR opportunity labels impact as model_knowledge (expected CTR heuristic)", () => {
  const ops = buildSearchOpsOpportunities({
    projectId: "p1",
    aiMentionRate: 0.5,
    aiSampleSize: 20,
    aiDataQuality: "measured",
    gscConnected: true,
    gscOpportunities: [
      {
        kind: "low_ctr",
        queryOrUrl: "emergency roof",
        impressions: 800,
        clicks: 4,
        ctr: 0.005,
        position: 3.2,
      },
    ],
  });
  const low = ops.find((o) => o.id.includes("lowctr"));
  assert.ok(low);
  assert.equal(low!.impactType, "model_knowledge");
  assert.ok(low!.evidence.some((e) => e.status === "measured"));
  assert.ok(low!.evidence.some((e) => e.status === "model_knowledge"));
});

test("schema findings are not duplicated by the built-in technical branch", () => {
  const ops = buildSearchOpsOpportunities({
    projectId: "p1",
    aiMentionRate: 0.5,
    aiSampleSize: 20,
    aiDataQuality: "measured",
    technicalFindings: [
      {
        id: "s1",
        severity: "high",
        category: "schema",
        title: "No structured data found",
        data_quality: "measured",
      },
    ],
    extraOpportunities: [
      {
        id: "p1:schema:s1",
        projectId: "p1",
        category: "technical",
        title: "Schema gap: No structured data found",
        diagnosis: "Measured crawl found no JSON-LD.",
        evidence: [
          {
            label: "Schema absence",
            source: "technical_findings",
            status: "measured",
            confidence: 0.85,
          },
          {
            label: "Recommended schema types",
            source: "schema guidance",
            status: "model_knowledge",
            confidence: 0.5,
          },
        ],
        priority: "high",
        impactType: "model_knowledge",
        effort: "medium",
        recommendedAction: "Add Organization JSON-LD; re-run technical audit.",
        verificationPlan: "Re-run technical audit; schema finding must resolve.",
        limitations: ["Schema presence is measured; rankings are not guaranteed."],
      },
    ],
  });
  assert.ok(!ops.some((o) => o.id === "p1:technical:s1"));
  assert.ok(ops.some((o) => o.id === "p1:schema:s1"));
});
