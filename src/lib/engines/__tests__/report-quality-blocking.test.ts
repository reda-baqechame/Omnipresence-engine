import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { ReportData } from "@/lib/engines/report-generator";
import {
  hasCriticalViolations,
  validateClaimInventoryItems,
  type ReportClaimInventoryItem,
} from "../report-quality-gate.ts";
import { finalizeIntelligenceReport } from "../report-builder.ts";
import type { IntelligenceReport } from "@/types/intelligence-report.ts";

const originalSanitize = process.env.REPORT_QUALITY_SANITIZE;
const originalBlock = process.env.REPORT_QUALITY_BLOCK_CRITICAL;

function restoreEnv() {
  if (originalSanitize === undefined) delete process.env.REPORT_QUALITY_SANITIZE;
  else process.env.REPORT_QUALITY_SANITIZE = originalSanitize;
  if (originalBlock === undefined) delete process.env.REPORT_QUALITY_BLOCK_CRITICAL;
  else process.env.REPORT_QUALITY_BLOCK_CRITICAL = originalBlock;
}

function baseScore() {
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
  } as ReportData["score"];
}

function baseReportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    project: {
      id: "proj-1",
      organization_id: "org-1",
      name: "Acme Co",
      domain: "acme.example",
      competitors: [],
      status: "active",
    } as ReportData["project"],
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

test("blocking flag off: critical violations do not block finalize path", async () => {
  delete process.env.REPORT_QUALITY_BLOCK_CRITICAL;
  delete process.env.REPORT_QUALITY_SANITIZE;

  const updates: Record<string, unknown>[] = [];
  const supabase = {
    from() {
      return {
        update(payload: Record<string, unknown>) {
          updates.push(payload);
          return {
            eq() {
              return this;
            },
            not() {
              return this;
            },
            select() {
              return this;
            },
            async maybeSingle() {
              return { data: { id: "report-1" } };
            },
          };
        },
      };
    },
    storage: {
      from() {
        return { async upload() { return { error: null }; } };
      },
    },
  };

  const report = baseReportData({
    score: {
      ...baseScore(),
      ai_visibility: 0,
      breakdown: { dimension_availability: { ai_visibility: false } },
    } as ReportData["score"],
  });

  let narrativeCalls = 0;
  await finalizeIntelligenceReport(
    supabase as never,
    "proj-1",
    "report-1",
    { report: report as unknown as IntelligenceReport },
    {
      generateReportNarrative: async () => {
        narrativeCalls++;
        return { executive: "ok" };
      },
      generateIntelligenceReportHTML: () => "<html></html>",
      renderReportPdf: async () => Buffer.from("%PDF-1.4"),
    }
  );

  assert.equal(narrativeCalls, 1);
  const readyUpdate = updates.find((u) => u.status === "ready");
  assert.ok(readyUpdate);
  restoreEnv();
});

test("blocking flag on: measured-without-evidence blocks before narrative", async () => {
  process.env.REPORT_QUALITY_BLOCK_CRITICAL = "1";
  delete process.env.REPORT_QUALITY_SANITIZE;

  const updates: Record<string, unknown>[] = [];
  const supabase = {
    from(table: string) {
      return {
        insert() {
          return Promise.resolve({ error: null });
        },
        update(payload: Record<string, unknown>) {
          updates.push({ table, ...payload });
          return {
            eq() {
              return this;
            },
            not() {
              return this;
            },
            select() {
              return this;
            },
            async maybeSingle() {
              return { data: { id: "report-1" } };
            },
          };
        },
      };
    },
    storage: {
      from() {
        return { async upload() { return { error: null }; } };
      },
    },
  };

  let narrativeCalls = 0;
  const patchedReport = {
    meta: {
      reportType: "deep",
      project: { id: "proj-1", organization_id: "org-1", name: "Acme", domain: "acme.example", competitors: [], status: "active" },
      generatedAt: new Date().toISOString(),
      sectionsIncluded: [],
      brandName: "Acme",
      domain: "acme.example",
    },
    executive: {
      available: true,
      dataQuality: "measured",
      omnipresenceScore: 55,
      scoreLabel: "Emerging",
      keyFindings: [],
      subScores: {},
      subScoresAvailable: {},
    },
    competitive: { available: false, dataQuality: "not_available", competitors: [] },
    visibility: {
      available: false,
      dataQuality: "not_available",
      snapshot: { ratesReliable: false, groundedCount: 0, metrics: { mentionRate: 0, citationRate: 0 }, reliabilityNote: "n/a" },
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
    coverageItems: [
      {
        id: "cov-1",
        project_id: "proj-1",
        platform_name: "G2",
        is_present: true,
        measured: false,
        data_quality: "measured",
        data_source: "measured",
      },
    ],
    authorityOpportunities: [],
    score: baseScore(),
    visibilityResults: [],
  } as IntelligenceReport;

  await finalizeIntelligenceReport(
    supabase as never,
    "proj-1",
    "report-1",
    { report: patchedReport },
    {
      generateReportNarrative: async () => {
        narrativeCalls++;
        return { executive: "bad" };
      },
      generateIntelligenceReportHTML: () => "<html></html>",
      renderReportPdf: async () => Buffer.from("%PDF-1.4"),
    }
  );

  assert.equal(narrativeCalls, 0);
  const failedUpdate = updates.find((u) => u.status === "failed");
  assert.ok(failedUpdate);
  assert.match(String(failedUpdate?.error_message), /unsupported measured claims/i);
  restoreEnv();
});

test("blocking flag on: warning-only violations do not block", async () => {
  process.env.REPORT_QUALITY_BLOCK_CRITICAL = "1";
  delete process.env.REPORT_QUALITY_SANITIZE;

  const item: ReportClaimInventoryItem = {
    claimId: "roadmap.item.0",
    section: "roadmap",
    claimType: "roadmap_item",
    field: "roadmapItems[0].title",
    value: "Generic SEO push",
    classification: "model_knowledge",
    customerVisibleText: "Improve SEO across the site to boost visibility",
  };
  const result = validateClaimInventoryItems([item]);
  assert.equal(hasCriticalViolations(result), false);
  assert.ok(result.violations.some((v) => v.severity === "warning"));
  restoreEnv();
});

test("sanitizer flag on + blocking flag off sanitizes without blocking", async () => {
  process.env.REPORT_QUALITY_SANITIZE = "1";
  delete process.env.REPORT_QUALITY_BLOCK_CRITICAL;

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

  const { sanitizeReportClaims } = await import("../report-quality-sanitizer.ts");
  const { validateReportClaims } = await import("../report-quality-gate.ts");
  const validation = validateReportClaims(report);
  const sanitized = sanitizeReportClaims(report, validation, {
    mode: "sanitize",
    reportType: "standard",
  });
  assert.ok(sanitized.sanitizedCount > 0);
  assert.notEqual(sanitized.report.roadmapItems[0].description, report.roadmapItems[0].description);
  restoreEnv();
});

test("unavailable-as-zero is a critical violation", () => {
  const item: ReportClaimInventoryItem = {
    claimId: "score.subscore.ai_visibility",
    section: "score",
    claimType: "subscore",
    field: "ai_visibility",
    value: 0,
    classification: "unavailable",
  };
  const result = validateClaimInventoryItems([item]);
  assert.ok(hasCriticalViolations(result));
});

test("fake measured dollar claim is critical", () => {
  const item: ReportClaimInventoryItem = {
    claimId: "roi.ads_replacement",
    section: "roi",
    claimType: "ads_replacement_value",
    field: "adsEquivalent.totalOrganicValue",
    value: 4500,
    classification: "measured",
    sourceLabel: "industry-average CPC estimate",
  };
  const result = validateClaimInventoryItems([item]);
  assert.ok(hasCriticalViolations(result));
});
