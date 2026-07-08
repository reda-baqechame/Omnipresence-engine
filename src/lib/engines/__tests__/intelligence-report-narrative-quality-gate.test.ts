import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { IntelligenceReport } from "@/types/intelligence-report";

/**
 * Patch F (no-evidence/no-claim report quality gate): generateReportNarrative()
 * must route Gemini's raw text through the SAME findForbiddenClaims() /
 * detectContentDefects() guards generate-router.ts already applies to
 * sovereign content generation, and fall back to the deterministic,
 * evidence-derived narrative on any hit — never ship a hallucinated outcome
 * promise or a raw LLM artifact (AI self-reference, refusal, placeholder) in
 * a paid deep report's executive summary.
 */

process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";

mock.module("@/lib/providers/cost-guard", {
  namedExports: {
    assertWithinBudget: async () => {},
    recordSpend: async () => {},
    BudgetExceededError: class BudgetExceededError extends Error {},
  },
});

const metricCalls: Array<{ name: string; value: number; tags?: Record<string, unknown> }> = [];
const realLog = await import("@/lib/observability/log");
mock.module("@/lib/observability/log", {
  namedExports: {
    ...realLog,
    recordMetric: (name: string, value: number, tags?: Record<string, unknown>) => {
      metricCalls.push({ name, value, tags });
    },
  },
});

const { generateReportNarrative } = await import("../intelligence-report-narrative.ts");

function baseReport(): IntelligenceReport {
  return {
    meta: {
      reportType: "deep",
      project: { id: "proj-1" } as never,
      generatedAt: new Date().toISOString(),
      sectionsIncluded: [],
      brandName: "Acme Co",
      domain: "acme.example",
    },
    executive: {
      available: true,
      dataQuality: "measured",
      omnipresenceScore: 62,
      scoreLabel: "Emerging",
      subScores: {},
      keyFindings: ["Strong AI visibility", "Weak backlink profile"],
    },
    competitive: { available: false },
    visibility: {
      available: true,
      dataQuality: "measured",
      snapshot: {
        ratesReliable: true,
        groundedCount: 20,
        metrics: { mentionRate: 0.4, citationRate: 0.2 },
        reliabilityNote: undefined,
      },
      topWinPrompts: [],
      competitorWinCount: 2,
    },
    keywords: { available: false, opportunities: [], strikingDistance: [], totalTracked: 0 },
    technical: { available: false, findings: [], criticalCount: 3, highCount: 1 },
  } as unknown as IntelligenceReport;
}

function mockFetchOnce(text: string) {
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = (async () =>
    new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
      { status: 200 }
    )) as typeof fetch;
  return () => {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  };
}

test("generateReportNarrative: a forbidden outcome promise from Gemini is rejected — deterministic fallback ships instead", async () => {
  metricCalls.length = 0;
  const restore = mockFetchOnce("We guarantee you will rank #1 on Google within 30 days.");
  try {
    const report = baseReport();
    const narrative = await generateReportNarrative(report);
    assert.ok(
      !narrative.executive?.includes("guarantee you will rank #1"),
      "forbidden LLM text must never reach the final narrative"
    );
    // Deterministic fallback still produces a real executive summary, not an empty string.
    assert.ok(narrative.executive && narrative.executive.length > 0);
    assert.ok(
      metricCalls.some((m) => m.name === "deep_report.narrative_rejected"),
      "a rejection metric must be recorded"
    );
  } finally {
    restore();
  }
});

test("generateReportNarrative: an unprofessional LLM artifact (AI self-reference) is rejected — deterministic fallback ships instead", async () => {
  metricCalls.length = 0;
  const restore = mockFetchOnce("As an AI language model, I can say your visibility is improving steadily.");
  try {
    const report = baseReport();
    const narrative = await generateReportNarrative(report);
    assert.ok(!narrative.executive?.includes("As an AI language model"));
    assert.ok(metricCalls.some((m) => m.name === "deep_report.narrative_rejected"));
  } finally {
    restore();
  }
});

test("generateReportNarrative: clean, professional Gemini output passes the gate and is used verbatim", async () => {
  metricCalls.length = 0;
  const cleanText =
    "Acme Co shows strong AI visibility momentum with a 40% mention rate across grounded probes, though backlink authority remains a growth constraint. Prioritizing the technical fixes below will compound existing AI-channel gains.";
  const restore = mockFetchOnce(cleanText);
  try {
    const report = baseReport();
    const narrative = await generateReportNarrative(report);
    assert.equal(narrative.executive, cleanText);
    assert.equal(metricCalls.filter((m) => m.name === "deep_report.narrative_rejected").length, 0);
  } finally {
    restore();
  }
});

test("generateReportNarrative: LLM disabled via opts falls back without ever calling Gemini", async () => {
  metricCalls.length = 0;
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = (async () => {
    fetchCalled = true;
    throw new Error("must not be called");
  }) as typeof fetch;
  try {
    const report = baseReport();
    const narrative = await generateReportNarrative(report, { useLlm: false });
    assert.equal(fetchCalled, false);
    assert.ok(narrative.executive && narrative.executive.includes("OmniPresence score"));
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
});
