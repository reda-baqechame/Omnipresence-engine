import { test } from "node:test";
import assert from "node:assert/strict";
import { generateReportHTML, type ReportData } from "../report-generator.ts";
import type { OmniPresenceScore, Project } from "@/types/database";

/**
 * P3 fix ("methodology appendix"): the standard-report PDF/HTML previously
 * presented every score, rate, and dollar figure with zero explanation of
 * how it was derived or whether it was measured vs. estimated. This test
 * pins that a "Methodology & Data Sources" section is always rendered, and
 * that it honestly reflects THIS report's actual provenance (real vs.
 * estimated CPC) rather than a static, always-identical disclaimer block.
 */

function baseProject(): Project {
  return {
    id: "proj-1",
    organization_id: "org-1",
    name: "Acme Co",
    domain: "acme.com",
    competitors: ["Rival Inc"],
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function baseScore(): OmniPresenceScore {
  return {
    id: "score-1",
    project_id: "proj-1",
    omnipresence_score: 62,
    ai_visibility: 40,
    search_visibility: 70,
    local_visibility: 55,
    social_presence: 30,
    directory_coverage: 60,
    authority_mentions: 45,
    technical_readiness: 80,
    conversion_readiness: 50,
    created_at: new Date().toISOString(),
  };
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

test("methodology appendix: always renders, explaining score/AI-visibility/coverage derivation", () => {
  const html = generateReportHTML(baseReportData());
  assert.match(html, /Methodology &amp; Data Sources/);
  assert.match(html, /OmniPresence Score/);
  assert.match(html, /excluded from the composite and shown as/);
  assert.match(html, /AI Visibility \(mention\/citation\/win rate\)/);
  assert.match(html, /Wilson score interval/);
  assert.match(html, /DATA_CONTRACT\.md/);
});

test("methodology appendix: reflects real CPC provenance when adsEquivalent.cpcSource is 'real'", () => {
  const html = generateReportHTML(
    baseReportData({
      adsEquivalent: {
        totalOrganicValue: 1000,
        replacementRatio: 0.5,
        statedAdSpend: 2000,
        cpcSource: "real",
      },
    })
  );
  assert.match(html, /your real keyword CPC \(Google Ads Keyword Planner\)/);
  assert.match(html, /Google Ads Keyword Planner \(real CPC\)/);
  assert.doesNotMatch(html, /connect DataForSEO for your exact CPC/);
});

test("methodology appendix: honestly labels an estimated CPC, not silently as real", () => {
  const html = generateReportHTML(
    baseReportData({
      adsEquivalent: {
        totalOrganicValue: 1000,
        replacementRatio: 0.5,
        statedAdSpend: 2000,
        cpcSource: "industry_estimate",
      },
    })
  );
  assert.match(html, /an industry-average CPC estimate — connect DataForSEO for your exact CPC/);
  assert.doesNotMatch(html, /Google Ads Keyword Planner \(real CPC\)/);
});

test("methodology appendix: omits the paid-ads-replacement row entirely when no ROI data exists (never fabricates a method for data that isn't there)", () => {
  const html = generateReportHTML(baseReportData());
  assert.doesNotMatch(html, /Paid ads replacement value/);
});
