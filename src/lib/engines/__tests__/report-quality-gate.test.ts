import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { ReportData } from "@/lib/engines/report-generator";
import type { IntelligenceReport } from "@/types/intelligence-report";
import {
  inventoryReportClaims,
  validateReportClaims,
  validateClaimInventoryItems,
  summarizeReportClaimViolations,
  hasCriticalViolations,
  type ReportClaimInventoryItem,
} from "../report-quality-gate.ts";

function baseProject() {
  return {
    id: "proj-1",
    organization_id: "org-1",
    name: "Acme Co",
    domain: "acme.example",
    competitors: ["Rival Co"],
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
      subScores: { ai_visibility: 40 },
      subScoresAvailable: { ai_visibility: true, local_visibility: false },
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
    ...overrides,
  } as IntelligenceReport;
}

test("every inventory item has a stable claimId", () => {
  const report = baseReportData({
    visibilityResults: [
      {
        id: "vr-1",
        run_id: "run-1",
        project_id: "proj-1",
        engine: "chatgpt",
        prompt_text: "best crm",
        brand_mentioned: true,
        brand_cited: false,
        competitor_mentions: { "Rival Co": true },
        competitor_citations: {},
        source_domains: [],
        cited_urls: [],
        data_source: "measured",
      },
    ],
    roadmapItems: [
      {
        week: 1,
        title: "Fix LCP",
        description: "Reduce LCP on /pricing",
        impact: "high",
        category: "technical",
        evidence_label: "CrUX",
        source_type: "technical_finding",
      },
    ],
  });
  const inventory = inventoryReportClaims(report);
  assert.ok(inventory.length > 0);
  for (const item of inventory) {
    assert.ok(item.claimId, `missing claimId on ${item.field}`);
  }
});

test("standard report share-of-voice is inventoried when visibilityResults contain competitors", () => {
  const report = baseReportData({
    visibilityResults: [
      {
        id: "vr-1",
        run_id: "run-1",
        project_id: "proj-1",
        engine: "chatgpt",
        prompt_text: "best crm",
        brand_mentioned: true,
        brand_cited: true,
        competitor_mentions: { "Rival Co": false },
        competitor_citations: {},
        source_domains: ["example.com"],
        cited_urls: [],
        data_source: "measured",
        raw_response: {
          entity_prominence: { "Acme Co": { strength: 1, position: 1 }, "Rival Co": { strength: 0.5, position: 2 } },
        },
      },
    ],
  });
  const inventory = inventoryReportClaims(report);
  assert.ok(inventory.some((i) => i.claimId === "visibility.sov"));
});

test("normal professional roadmap item does not emit estimated-without-label warning", () => {
  const report = baseReportData({
    roadmapItems: [
      {
        week: 1,
        title: "Fix critical CWV regression",
        description: "Reduce LCP on /pricing from 4.2s to under 2.5s",
        impact: "critical",
        category: "technical",
      },
    ],
  });
  const result = validateReportClaims(report);
  const estimateWarnings = result.violations.filter((v) =>
    v.reason.includes("not clearly labeled as estimated")
  );
  assert.equal(estimateWarnings.length, 0);
});

test("technical finding generic fix recommendation warns despite technical finding ID", () => {
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
  const result = validateReportClaims(report);
  assert.ok(
    result.violations.some(
      (v) =>
        v.claimType === "technical_recommendation" &&
        v.reason.includes("Generic unsupported recommendation")
    )
  );
});

test("executive key finding self-pointer does not count as measured evidence", () => {
  const item: ReportClaimInventoryItem = {
    claimId: "executive.key_finding.0",
    section: "executive",
    claimType: "key_finding",
    field: "executive.keyFindings[0]",
    value: "Strong visibility",
    classification: "measured",
    evidencePointer: "executive.keyFindings[0]",
    sourceLabel: null,
    customerVisibleText: "Strong visibility",
  };
  const result = validateClaimInventoryItems([item]);
  assert.ok(
    result.violations.some(
      (v) => v.claimType === "key_finding" && v.reason.includes("no evidence pointer")
    )
  );
});

test("IntelligenceReport inventory includes ppc/entity/schema/community/reputation when present", () => {
  const report = baseIntelligenceReport({
    ppc: { available: true, dataQuality: "measured", competitorAdCount: 2, highlights: ["Competitor ads detected"] },
    entity: { available: true, dataQuality: "measured", sameAsCount: 3, gaps: [] },
    schema: { available: true, dataQuality: "measured", deployments: 2, types: ["Organization"], issues: [] },
    community: { available: true, dataQuality: "measured", mentions: [], totalMentions: 4 },
    reputation: { available: true, dataQuality: "measured", newsMentions: 1, highlights: ["Press mention"] },
  });
  const ids = inventoryReportClaims(report).map((i) => i.claimId);
  for (const expected of [
    "intelligence.ppc",
    "intelligence.entity",
    "intelligence.schema",
    "intelligence.community",
    "intelligence.reputation",
  ]) {
    assert.ok(ids.includes(expected), `missing ${expected}`);
  }
});

test("measured claim with evidence passes via validateReportClaims(ReportData)", () => {
  const report = baseReportData({
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

test("measured claim without evidence creates error via validateClaimInventoryItems", () => {
  const item: ReportClaimInventoryItem = {
    claimId: "score.overall",
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

test("unavailable explicit label with no numeric zero passes on IntelligenceReport", () => {
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
  const adsViolations = validateReportClaims(report).violations.filter(
    (v) => v.claimType === "ads_replacement_value"
  );
  assert.equal(adsViolations.length, 0);
});

test("ads-replacement with estimated CPC but no estimated label creates warning", () => {
  const item: ReportClaimInventoryItem = {
    claimId: "roi.ads_replacement",
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

test("ads-replacement unavailable does not create fake $0 violation", () => {
  const report = baseReportData({ adsEquivalent: undefined });
  const zeroViolations = validateReportClaims(report).violations.filter(
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
  const genericWarnings = validateReportClaims(report).violations.filter((v) =>
    v.reason.includes("Generic unsupported recommendation")
  );
  assert.equal(genericWarnings.length, 0);
});

test("narrative sections are inventoried when options.narrative is provided", () => {
  const report = baseIntelligenceReport();
  const inventory = inventoryReportClaims(report, {
    narrative: { executive: "Acme shows emerging AI visibility with grounded probes." },
  });
  assert.ok(inventory.some((i) => i.claimId === "narrative.executive"));
});

test("summarizeReportClaimViolations describes violation counts", () => {
  const report = baseReportData({
    score: baseScore({
      ai_visibility: 0,
      breakdown: { dimension_availability: { ai_visibility: false } },
    }),
  });
  const summary = summarizeReportClaimViolations(validateReportClaims(report));
  assert.match(summary, /violation/i);
});

test("forbidden guaranteed phrase creates critical error violation", () => {
  const report = baseReportData({
    roadmapItems: [
      {
        week: 1,
        title: "Guaranteed win",
        description: "We guarantee you will rank #1 on Google within 30 days",
        impact: "high",
        category: "content",
      },
    ],
  });
  const result = validateReportClaims(report);
  assert.ok(
    result.violations.some(
      (v) =>
        v.severity === "error" &&
        v.reason.includes("Unsupported guaranteed ranking/traffic/revenue claim")
    )
  );
});

test("hasCriticalViolations identifies measured-without-evidence", () => {
  const item: ReportClaimInventoryItem = {
    claimId: "score.overall",
    section: "score",
    claimType: "overall_score",
    field: "omnipresence_score",
    value: 55,
    classification: "measured",
    evidencePointer: null,
    sourceLabel: null,
  };
  assert.ok(hasCriticalViolations(validateClaimInventoryItems([item])));
});

test("persistReportQualityViolations stores rows and catches DB errors without throwing", async () => {
  const inserts: unknown[] = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, "report_quality_violations");
      return {
        insert(rows: unknown) {
          inserts.push(rows);
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const { persistReportQualityViolations } = await import("../report-quality-persistence.ts");
  const item: ReportClaimInventoryItem = {
    claimId: "roadmap.item.0",
    section: "roadmap",
    claimType: "roadmap_item",
    field: "roadmapItems[0].title",
    value: "x",
    classification: "model_knowledge",
  };
  await persistReportQualityViolations({
    supabase: supabase as never,
    result: {
      passed: false,
      inventory: [item],
      violations: [
        {
          claimId: "roadmap.item.0",
          section: "roadmap",
          claimType: "roadmap_item",
          field: "roadmapItems[0].title",
          reason: "Generic unsupported recommendation phrase.",
          severity: "warning",
        },
      ],
    },
    reportType: "standard",
    projectId: "proj-1",
    reportId: "rep-1",
    renderPath: "test",
  });
  assert.equal(inserts.length, 1);

  let warned = false;
  const originalWarn = console.warn;
  console.warn = () => {
    warned = true;
  };
  await persistReportQualityViolations({
    supabase: {
      from() {
        return {
          insert() {
            return Promise.resolve({ error: { message: "db down" } });
          },
        };
      },
    } as never,
    result: {
      passed: false,
      inventory: [item],
      violations: [
        {
          claimId: "roadmap.item.0",
          section: "roadmap",
          claimType: "roadmap_item",
          field: "roadmapItems[0].title",
          reason: "test",
          severity: "warning",
        },
      ],
    },
    reportType: "standard",
  });
  console.warn = originalWarn;
  assert.equal(warned, true);
});
