import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReportData } from "@/lib/engines/report-generator";
import type { IntelligenceReport } from "@/types/intelligence-report";
import {
  validateReportClaims,
  validateClaimInventoryItems,
  summarizeReportClaimViolations,
  type ReportClaimInventoryItem,
} from "../report-quality-gate.ts";

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

function baseIntelligenceReport(overrides: Partial<IntelligenceReport> = {}): IntelligenceReport {
  return {
    meta: {
      reportType: "deep",
      project: baseProject(),
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
      keyFindings: ["Measured visibility from grounded probes"],
    },
    competitive: { available: false, dataQuality: "not_available", competitors: [] },
    visibility: {
      available: false,
      dataQuality: "not_available",
      snapshot: {
        ratesReliable: false,
        groundedCount: 0,
        metrics: { mentionRate: 0, citationRate: 0 },
        reliabilityNote: "Insufficient probe coverage for rates",
      },
      topWinPrompts: [],
      competitorWinCount: 0,
    },
    keywords: {
      available: false,
      dataQuality: "not_available",
      opportunities: [],
      strikingDistance: [],
      totalTracked: 0,
    },
    backlinks: {
      available: false,
      dataQuality: "not_available",
      referringDomains: 0,
      topReferrers: [],
      authoritySources: [],
    },
    technical: { available: false, dataQuality: "not_available", findings: [], criticalCount: 0, highCount: 0 },
    local: { available: false, dataQuality: "not_available", listingsFound: 0, gaps: [] },
    entity: { available: false, dataQuality: "not_available", sameAsCount: 0, gaps: [] },
    schema: { available: false, dataQuality: "not_available", deployments: 0, types: [], issues: [] },
    community: { available: false, dataQuality: "not_available", mentions: [], totalMentions: 0 },
    reputation: { available: false, dataQuality: "not_available", newsMentions: 0, highlights: [] },
    ppc: { available: false, dataQuality: "not_available", competitorAdCount: 0, highlights: [] },
    roi: { available: false, dataQuality: "not_available" },
    roadmap: { available: false, dataQuality: "not_available", items: [] },
    proof: {
      available: false,
      dataQuality: "not_available",
      ledgerActions: 0,
      deliverablesMet: 0,
      deliverablesTotal: 0,
    },
    methodology: { available: true, dataQuality: "measured", providersUsed: [], attributions: [], disclaimers: [] },
    coverageItems: [],
    authorityOpportunities: [],
    score: baseScore(),
    visibilityResults: [],
    ...overrides,
  } as IntelligenceReport;
}

test("measured claim with evidence passes", () => {
  const report = baseReportData({
    score: baseScore({ data_source: "measured" }),
    visibilityResults: [
      {
        id: "vr-1",
        run_id: "run-1",
        project_id: "proj-1",
        engine: "chatgpt",
        prompt_text: "best crm",
        brand_mentioned: true,
        brand_cited: false,
        competitor_mentions: {},
        competitor_citations: {},
        source_domains: [],
        cited_urls: [],
        data_source: "measured",
      },
    ],
    adsEquivalent: {
      totalOrganicValue: 4200,
      replacementRatio: 0.8,
      statedAdSpend: 5000,
      cpcSource: "real",
    },
  });

  const result = validateReportClaims(report);
  assert.equal(
    result.violations.some((v) => v.reason.includes("no evidence")),
    false
  );
});

test("measured claim without evidence creates error violation", () => {
  const item: ReportClaimInventoryItem = {
    section: "score",
    claimType: "overall_score",
    field: "omnipresence_score",
    value: 55,
    classification: "measured",
    evidencePointer: null,
    sourceLabel: null,
  };

  const result = validateClaimInventoryItems([item]);
  assert.ok(
    result.violations.some(
      (v) => v.severity === "error" && v.reason.includes("no evidence pointer")
    )
  );
});

test("estimated claim without visible estimate label creates warning violation", () => {
  const report = baseReportData({
    roadmapItems: [
      {
        week: 2,
        title: "Expand keyword coverage",
        description: "Target additional commercial keywords this quarter",
        impact: "medium",
        category: "keywords",
      },
    ],
  });

  const result = validateReportClaims(report);
  assert.ok(
    result.violations.some(
      (v) =>
        v.severity === "warning" &&
        v.reason.includes("not clearly labeled as estimated")
    )
  );
});

test("unavailable numeric zero creates error violation", () => {
  const report = baseReportData({
    score: baseScore({
      ai_visibility: 0,
      breakdown: { dimension_availability: { ai_visibility: false } },
      data_source: "measured",
    }),
  });

  const result = validateReportClaims(report);
  assert.ok(
    result.violations.some(
      (v) => v.severity === "error" && v.reason.includes("represented as zero")
    )
  );
});

test("unavailable explicit label with no numeric zero passes", () => {
  const report = baseIntelligenceReport();
  const result = validateReportClaims(report);
  const visViolation = result.violations.find(
    (v) => v.section === "visibility" && v.reason.includes("represented as zero")
  );
  assert.equal(visViolation, undefined);
});

test("ads-replacement with cpcSource real passes as measured", () => {
  const report = baseReportData({
    adsEquivalent: {
      totalOrganicValue: 5000,
      replacementRatio: 0.9,
      statedAdSpend: 5500,
      cpcSource: "real",
    },
  });

  const result = validateReportClaims(report);
  const adsViolations = result.violations.filter((v) => v.claimType === "ads_replacement_value");
  assert.equal(adsViolations.length, 0);
});

test("ads-replacement with estimated CPC but no estimated label creates warning", () => {
  const item: ReportClaimInventoryItem = {
    section: "roi",
    claimType: "ads_replacement_value",
    field: "adsEquivalent.totalOrganicValue",
    value: 2000,
    classification: "estimated",
    sourceLabel: "industry_estimate",
    customerVisibleText: "Replacement value $2000 monthly",
  };

  const result = validateClaimInventoryItems([item]);
  assert.ok(
    result.violations.some((v) => v.reason.includes("estimated CPC without estimated label"))
  );
});

test("ads-replacement unavailable does not create fake $0 violation if no dollar value shown", () => {
  const report = baseReportData({ adsEquivalent: undefined });
  const result = validateReportClaims(report);
  const zeroViolations = result.violations.filter(
    (v) => v.claimType === "ads_replacement_value" && v.reason.includes("represented as zero")
  );
  assert.equal(zeroViolations.length, 0);
});

test("forbidden generic phrase creates warning violation", () => {
  const report = baseReportData({
    roadmapItems: [
      {
        week: 1,
        title: "Generic SEO push",
        description: "Improve SEO across the site to boost visibility",
        impact: "medium",
        category: "content",
      },
    ],
  });

  const result = validateReportClaims(report);
  assert.ok(
    result.violations.some(
      (v) => v.severity === "warning" && v.reason.includes("Generic unsupported recommendation")
    )
  );
});

test("valid professional recommendation with evidence passes", () => {
  const report = baseReportData({
    roadmapItems: [
      {
        week: 1,
        title: "Fix critical CWV regression",
        description: "Reduce LCP on /pricing from 4.2s to under 2.5s based on CrUX p75",
        impact: "critical",
        category: "technical",
        evidence_label: "CrUX p75 LCP 4200ms",
        evidence_url: "https://acme.example/pricing",
        source_type: "technical_finding",
      },
    ],
  });

  const result = validateReportClaims(report);
  const genericWarnings = result.violations.filter((v) =>
    v.reason.includes("Generic unsupported recommendation")
  );
  assert.equal(genericWarnings.length, 0);
});

test("summarizeReportClaimViolations describes violation counts", () => {
  const report = baseReportData({
    score: baseScore({
      ai_visibility: 0,
      breakdown: { dimension_availability: { ai_visibility: false } },
    }),
  });
  const result = validateReportClaims(report);
  const summary = summarizeReportClaimViolations(result);
  assert.match(summary, /violation/i);
});
