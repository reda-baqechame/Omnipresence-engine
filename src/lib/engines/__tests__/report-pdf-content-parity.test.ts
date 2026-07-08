import { test } from "node:test";
import assert from "node:assert/strict";
import { generateReportPDF } from "../report-pdf.tsx";
import type { ReportData } from "../report-generator.ts";
import { extractPdfText } from "../../../../tests/_lib/pdf-text.mjs";
import type {
  Project,
  OmniPresenceScore,
  TechnicalFinding,
  CoverageItem,
  RoadmapItem,
  VisibilityResult,
} from "@/types/database.ts";

/**
 * Patch A/B (PDF report parity): a hostile audit found the downloadable PDF
 * (generateReportPDF -> report-pdf-document.tsx) was a much thinner artifact
 * than the parallel generateReportHTML() output — missing AI visibility,
 * Wilson confidence intervals, share-of-voice, ads-replacement value, CPC
 * provenance, and the "Methodology & Data Sources" appendix entirely, even
 * though prior tests only ever pinned generateReportHTML() strings.
 *
 * These tests extract REAL TEXT from the REAL PDF BYTES produced by
 * generateReportPDF() (via pdfjs-dist, not a mock) and would FAIL against
 * the old thin PDF implementation, which never rendered this content at
 * all. A source-text/string-match test on report-pdf-document.tsx would not
 * catch a regression where the JSX renders but a section silently omits
 * text (e.g. an empty conditional) — parsing the actual PDF bytes does.
 */

const BASE_PROJECT: Project = {
  id: "11111111-1111-1111-1111-111111111111",
  organization_id: "22222222-2222-2222-2222-222222222222",
  name: "Acme Roofing Co",
  domain: "acmeroofing.com",
  competitors: ["Rival Roofing"],
  status: "active",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const BASE_SCORE: OmniPresenceScore = {
  id: "33333333-3333-3333-3333-333333333333",
  project_id: BASE_PROJECT.id,
  omnipresence_score: 62,
  ai_visibility: 40,
  search_visibility: 70,
  local_visibility: 55,
  social_presence: 65,
  directory_coverage: 80,
  authority_mentions: 50,
  technical_readiness: 75,
  conversion_readiness: 60,
  created_at: "2026-01-15T00:00:00.000Z",
};

function measuredVisibilityResults(): VisibilityResult[] {
  const base = {
    run_id: "run-1",
    project_id: BASE_PROJECT.id,
    prompt_id: "p1",
    competitor_citations: {},
    source_domains: [],
    cited_urls: [],
    sentiment: "positive" as const,
    data_source: "measured" as const,
    measurement_mode: "grounded" as const,
    recommendation_strength: 0.9,
    answer_position: 1,
    confidence: 0.9,
    sample_count: 3,
    created_at: "2026-01-15T00:00:00.000Z",
  };
  const results: VisibilityResult[] = [
    {
      ...base,
      id: "vr-1",
      engine: "chatgpt",
      prompt_text: "best roofing company near me",
      brand_mentioned: true,
      brand_cited: true,
      competitor_mentions: { "Rival Roofing": false },
    },
    {
      ...base,
      id: "vr-2",
      engine: "claude",
      prompt_text: "who offers emergency roof repair",
      brand_mentioned: false,
      brand_cited: false,
      competitor_mentions: { "Rival Roofing": true },
      recommendation_strength: 0,
      answer_position: undefined,
    },
    {
      ...base,
      id: "vr-3",
      engine: "gemini",
      prompt_text: "top rated roofers",
      brand_mentioned: true,
      brand_cited: false,
      competitor_mentions: { "Rival Roofing": true },
      recommendation_strength: 0.5,
      answer_position: 2,
    },
  ];
  return results;
}

function findings(): TechnicalFinding[] {
  return [
    {
      id: "f1",
      project_id: BASE_PROJECT.id,
      category: "performance",
      severity: "critical",
      title: "LCP exceeds 4s on mobile",
      description: "Largest Contentful Paint is 4.8s on the homepage.",
      is_resolved: false,
      created_at: "2026-01-10T00:00:00.000Z",
    },
  ];
}

function coverage(): CoverageItem[] {
  return [
    {
      id: "c1",
      project_id: BASE_PROJECT.id,
      surface: "directory",
      platform_name: "Google Business Profile",
      is_present: false,
      is_optimized: false,
      competitor_present: true,
      created_at: "2026-01-10T00:00:00.000Z",
      updated_at: "2026-01-10T00:00:00.000Z",
    } as CoverageItem,
  ];
}

function roadmap(): RoadmapItem[] {
  return [
    {
      week: 1,
      title: "Fix critical Core Web Vitals regressions",
      description: "Compress hero images and defer non-critical JS.",
      impact: "critical",
      category: "technical",
    },
  ];
}

function fullReportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    project: BASE_PROJECT,
    score: BASE_SCORE,
    technicalFindings: findings(),
    coverageItems: coverage(),
    authorityOpportunities: [],
    roadmapItems: roadmap(),
    visibilityResults: measuredVisibilityResults(),
    strikingKeywords: [{ keyword: "roof repair near me", position: 7, url: "https://acmeroofing.com/repair" }],
    generatedAt: "2026-01-15T00:00:00.000Z",
    adsEquivalent: {
      totalOrganicValue: 4200,
      replacementRatio: 0.6,
      statedAdSpend: 7000,
      cpcSource: "real",
    },
    ...overrides,
  };
}

test("generateReportPDF: real PDF bytes contain the full professional report — methodology, AI visibility, Wilson CI, share of voice, ads replacement, real CPC", async () => {
  const buffer = await generateReportPDF(fullReportData());
  const text = await extractPdfText(buffer);

  assert.match(text, /Methodology.{0,3}(&|and).{0,3}Data Sources/i, "PDF must include the Methodology & Data Sources appendix");
  assert.match(text, /AI Visibility/, "PDF must include an AI Visibility section");
  assert.match(text, /Wilson/i, "PDF methodology must name the Wilson score interval");
  assert.match(text, /confidence/i, "PDF must explain measurement confidence");
  assert.match(text, /Share of Voice/i, "PDF must include AI share-of-voice content");
  assert.match(text, /Ads-Replacement|ads replacement|Paid ads replacement/i, "PDF must include ads-replacement value content");
  assert.match(text, /real CPC|Real CPC/, "PDF must label a real CPC source explicitly");
  assert.match(text, /Data Sources/, "PDF must list data sources / provenance");
  assert.match(text, /Prioritized Recommendations/i, "PDF must include prioritized recommendations");
  assert.match(text, /Roadmap/i, "PDF must include the execution roadmap");
  assert.match(text, /Evidence Summary/i, "PDF must include an evidence summary section");
  assert.match(text, /Limitations/i, "PDF must include a limitations/unavailable-data section");
});

test("generateReportPDF: labels an estimated/industry CPC as estimated, never as real CPC", async () => {
  const buffer = await generateReportPDF(
    fullReportData({
      adsEquivalent: {
        totalOrganicValue: 4200,
        replacementRatio: 0.6,
        statedAdSpend: 7000,
        cpcSource: "industry_estimate",
      },
    })
  );
  const text = await extractPdfText(buffer);

  assert.match(text, /Estimated CPC/i, "an industry_estimate CPC source must render as 'Estimated CPC'");
  assert.doesNotMatch(text, /Real CPC/, "an industry_estimate CPC source must never be labeled 'Real CPC'");
  assert.match(text, /industry-average CPC estimate/, "must explain the estimate provenance in the methodology/legend text");
});

test("generateReportPDF: no AI visibility samples renders 'Unavailable', never a fake 0% mention rate", async () => {
  const buffer = await generateReportPDF(fullReportData({ visibilityResults: [] }));
  const text = await extractPdfText(buffer);

  assert.doesNotMatch(text, /0% Mention Rate/, "must never render a fabricated 0% mention rate when there is no data");
  assert.match(text, /Unavailable/, "must explicitly say AI visibility is unavailable when there are no measured probes");
  assert.match(text, /no AI engine probes returned measured data/i, "must explain WHY the AI visibility rate is unavailable");
});

test("generateReportPDF: with no ads/CPC data, shows no fabricated dollar value and marks the section Unavailable", async () => {
  const buffer = await generateReportPDF(fullReportData({ adsEquivalent: undefined }));
  const text = await extractPdfText(buffer);

  assert.doesNotMatch(text, /Stated Ad Spend/, "must not render fabricated ad-spend/CPC dollar metrics when there is no such data");
  assert.doesNotMatch(text, /\$\d/, "must not render any fabricated dollar figure when there is no ad-spend/CPC data");
  assert.match(text, /Unavailable/, "must mark the ads-replacement section as Unavailable rather than omitting it silently");
  assert.match(text, /No ad-spend\/CPC data/i, "must explain why no dollar value is shown");
});

test("generateReportPDF: unmeasured score dimensions render as unavailable (—), not a fabricated numeric 0", async () => {
  const scoreWithGaps: OmniPresenceScore = {
    ...BASE_SCORE,
    social_presence: 0,
    directory_coverage: 0,
    breakdown: {
      dimension_availability: {
        ai_visibility: true,
        search_visibility: true,
        local_visibility: true,
        social_presence: false,
        directory_coverage: false,
        authority_mentions: true,
        technical_readiness: true,
        conversion_readiness: true,
      },
    },
  };
  const buffer = await generateReportPDF(fullReportData({ score: scoreWithGaps }));
  const text = await extractPdfText(buffer);

  assert.match(text, /Social, Directories|Directories, Social/, "the Limitations section must name the unavailable dimensions");
  assert.match(text, /excluded from the composite/i, "must explain that unmeasured dimensions are excluded, not scored as zero");
});
