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
