import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReportData } from "@/lib/engines/report-generator";
import {
  sanitizeReportClaims,
  SAFE_GENERIC_RECOMMENDATION,
  formatUnavailableAiVisibility,
} from "../report-quality-sanitizer.ts";
import { validateReportClaims } from "../report-quality-gate.ts";

function baseProject() {
  return {
    id: "proj-1",
    organization_id: "org-1",
    name: "Acme Co",
    domain: "acme.example",
    competitors: [],
    status: "active",
  } as ReportData["project"];
}

function baseScore(overrides: Record<string, unknown> = {}) {
  return {
    id: "score-1",
    project_id: "proj-1",
    omnipresence_score: 62,
    ai_visibility: 40,
    search_visibility: 55,
    local_visibility: 50,
    social_presence: 45,
    directory_coverage: 60,
    authority_mentions: 35,
    technical_readiness: 70,
    conversion_readiness: 50,
    data_source: "measured",
    ...overrides,
  } as ReportData["score"];
}

function baseReportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    project: baseProject(),
    score: baseScore(),
    technicalFindings: [],
    coverageItems: [],
    authorityOpportunities: [],
    roadmapItems: [],
    visibilityResults: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("observe mode leaves report unchanged", () => {
  const report = baseReportData({
    roadmapItems: [
      {
        week: 1,
        title: "SEO push",
        description: "Improve SEO to boost rankings",
        impact: "medium",
        category: "content",
      },
    ],
  });
  const validation = validateReportClaims(report);
  const result = sanitizeReportClaims(report, validation, {
    mode: "observe",
    reportType: "standard",
  });
  assert.equal(result.sanitizedCount, 0);
  assert.equal(result.report.roadmapItems[0].description, "Improve SEO to boost rankings");
});

test("sanitize mode converts generic roadmap recommendation to safe language", () => {
  const report = baseReportData({
    roadmapItems: [
      {
        week: 1,
        title: "SEO push",
        description: "Improve SEO to boost rankings",
        impact: "medium",
        category: "content",
      },
    ],
  });
  const validation = validateReportClaims(report);
  const result = sanitizeReportClaims(report, validation, {
    mode: "sanitize",
    reportType: "standard",
  });
  assert.ok(result.sanitizedCount > 0);
  assert.equal(result.report.roadmapItems[0].description, SAFE_GENERIC_RECOMMENDATION);
});

test("sanitize mode does not invent unavailable data as zero", () => {
  const report = baseReportData({ adsEquivalent: undefined });
  const validation = validateReportClaims(report);
  const result = sanitizeReportClaims(report, validation, {
    mode: "sanitize",
    reportType: "standard",
  });
  assert.equal(result.report.adsEquivalent, undefined);
});

test("sanitize mode clears unavailable ads equivalent without fabricating dollars", () => {
  const report = baseReportData({
    adsEquivalent: {
      totalOrganicValue: 0,
      replacementRatio: 0,
      statedAdSpend: 0,
      cpcSource: "industry_estimate",
    },
  });
  const validation = validateReportClaims({
    ...report,
    adsEquivalent: undefined,
  });
  const unavailableValidation = validateReportClaims(baseReportData({ adsEquivalent: undefined }));
  const result = sanitizeReportClaims(report, unavailableValidation, {
    mode: "sanitize",
    reportType: "standard",
  });
  assert.equal(result.report.adsEquivalent, undefined);
  assert.equal(validation.violations.some((v) => v.reason.includes("represented as zero")), false);
});

test("sanitize mode marks unavailable AI visibility with honest note", () => {
  const report = {
    meta: { reportType: "deep", project: baseProject(), generatedAt: new Date().toISOString(), sectionsIncluded: [], brandName: "Acme", domain: "acme.example" },
    executive: {
      available: true,
      dataQuality: "measured",
      omnipresenceScore: 62,
      scoreLabel: "Emerging",
      subScores: {},
      subScoresAvailable: {},
      keyFindings: [],
    },
    competitive: { available: false, dataQuality: "not_available", competitors: [] },
    visibility: {
      available: false,
      dataQuality: "not_available",
      snapshot: {
        ratesReliable: false,
        groundedCount: 0,
        metrics: { mentionRate: 0, citationRate: 0 },
        reliabilityNote: "Insufficient probe coverage",
      },
      topWinPrompts: [],
      competitorWinCount: 0,
    },
    keywords: { available: false, dataQuality: "not_available", opportunities: [], strikingDistance: [], totalTracked: 0 },
    backlinks: { available: false, dataQuality: "not_available", referringDomains: 0, topReferrers: [], authoritySources: [] },
    technical: { available: false, dataQuality: "not_available", findings: [], criticalCount: 0, highCount: 0 },
    local: { available: false, dataQuality: "not_available", listingsFound: 0, gaps: [] },
    entity: { available: false, dataQuality: "not_available", sameAsCount: 0, gaps: [] },
    schema: { available: false, dataQuality: "not_available", deployments: 0, types: [], issues: [] },
    community: { available: false, dataQuality: "not_available", mentions: [], totalMentions: 0 },
    reputation: { available: false, dataQuality: "not_available", newsMentions: 0, highlights: [] },
    ppc: { available: false, dataQuality: "not_available", competitorAdCount: 0, highlights: [] },
    roi: { available: false, dataQuality: "not_available" },
    roadmap: { available: false, dataQuality: "not_available", items: [] },
    proof: { available: false, dataQuality: "not_available", ledgerActions: 0, deliverablesMet: 0, deliverablesTotal: 0 },
    methodology: { available: true, dataQuality: "measured", providersUsed: [], attributions: [], disclaimers: [] },
    coverageItems: [],
    authorityOpportunities: [],
    score: baseScore(),
    visibilityResults: [],
  };
  const validation = validateReportClaims(report as never);
  const result = sanitizeReportClaims(report as never, validation, {
    mode: "sanitize",
    reportType: "deep_intelligence",
  });
  assert.equal(
    (result.report as { visibility: { snapshot: { reliabilityNote: string } } }).visibility.snapshot
      .reliabilityNote,
    formatUnavailableAiVisibility()
  );
});

test("sanitize mode converts technical fix recommendation slop", () => {
  const report = baseReportData({
    technicalFindings: [
      {
        id: "tf-1",
        project_id: "proj-1",
        category: "content",
        severity: "medium",
        title: "Thin content",
        description: "Landing page lacks depth",
        is_resolved: false,
        data_source: "measured",
        provider: "on-page-audit",
        fix_recommendation: "Improve SEO across key landing pages",
      },
    ],
  });
  const validation = validateReportClaims(report);
  const result = sanitizeReportClaims(report, validation, {
    mode: "sanitize",
    reportType: "standard",
  });
  assert.equal(result.report.technicalFindings[0].fix_recommendation, SAFE_GENERIC_RECOMMENDATION);
});
