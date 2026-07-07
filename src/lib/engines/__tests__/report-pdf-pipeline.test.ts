import { test } from "node:test";
import assert from "node:assert/strict";
import { generateReportPDF } from "../report-pdf.tsx";
import type { ReportData } from "../report-generator.ts";
import { renderReportPdf, hasAiUiCapture } from "@/lib/providers/ai-ui-capture.ts";
import type { Project, OmniPresenceScore, TechnicalFinding, CoverageItem, RoadmapItem } from "@/types/database.ts";

/**
 * Ticket 12 (Phase 0 plan #10): "No golden/E2E tests for the PDF pipeline or
 * cancellation — nothing exercises generateReportPDF, renderReportPdf, the
 * download route, or any cancel flow." These pin the two PDF-generation
 * seams: the standard @react-pdf/renderer path (byte-structure/MIME) and the
 * deep-report Playwright-service path's degraded-when-unconfigured contract
 * that report-builder.ts relies on to set pdf_degraded honestly.
 *
 * A byte-for-byte snapshot would be too brittle across @react-pdf/renderer
 * version bumps (font subsetting, compression, object ordering all vary) —
 * instead these assert the structural invariants a real PDF reader depends
 * on: %PDF- header, %%EOF trailer, and a sane minimum size for the amount of
 * content rendered.
 */

const BASE_PROJECT: Project = {
  id: "11111111-1111-1111-1111-111111111111",
  organization_id: "22222222-2222-2222-2222-222222222222",
  name: "Acme Roofing Co",
  domain: "acmeroofing.com",
  competitors: ["rival-roofing.com"],
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

function minimalReportData(): ReportData {
  return {
    project: BASE_PROJECT,
    score: BASE_SCORE,
    technicalFindings: [],
    coverageItems: [],
    authorityOpportunities: [],
    roadmapItems: [],
    visibilityResults: [],
    generatedAt: "2026-01-15T00:00:00.000Z",
  };
}

function fullReportData(): ReportData {
  const findings: TechnicalFinding[] = [
    {
      id: "f1",
      project_id: BASE_PROJECT.id,
      category: "performance",
      severity: "critical",
      title: "LCP exceeds 4s on mobile",
      description: "Largest Contentful Paint is 4.8s on the homepage, well above the 2.5s good threshold.",
      is_resolved: false,
      created_at: "2026-01-10T00:00:00.000Z",
    },
    {
      id: "f2",
      project_id: BASE_PROJECT.id,
      category: "indexing",
      severity: "high",
      title: "Missing canonical tags on 12 pages",
      description: "Duplicate content risk across category pages without canonical resolution.",
      is_resolved: false,
      created_at: "2026-01-10T00:00:00.000Z",
    },
  ];

  const coverage: CoverageItem[] = [
    {
      id: "c1",
      project_id: BASE_PROJECT.id,
      surface: "directory",
      platform_name: "Google Business Profile",
      is_present: false,
      is_optimized: false,
      competitor_present: true,
      created_at: "2026-01-10T00:00:00.000Z",
    } as CoverageItem,
  ];

  const roadmap: RoadmapItem[] = [
    {
      week: 1,
      title: "Fix critical Core Web Vitals regressions",
      description: "Compress hero images and defer non-critical JS to bring LCP under 2.5s.",
      impact: "critical",
      category: "technical",
    },
    {
      week: 3,
      title: "Claim and optimize Google Business Profile",
      description: "Close the highest-visibility local coverage gap versus rival-roofing.com.",
      impact: "high",
      category: "local",
    },
  ];

  return {
    project: BASE_PROJECT,
    score: BASE_SCORE,
    previousScore: { ...BASE_SCORE, omnipresence_score: 54 },
    technicalFindings: findings,
    coverageItems: coverage,
    authorityOpportunities: [],
    roadmapItems: roadmap,
    visibilityResults: [],
    strikingKeywords: [{ keyword: "roof repair near me", position: 7, url: "https://acmeroofing.com/repair" }],
    generatedAt: "2026-01-15T00:00:00.000Z",
    adsEquivalent: {
      totalOrganicValue: 4200,
      replacementRatio: 0.6,
      statedAdSpend: 7000,
      cpcSource: "real",
    },
  };
}

function assertValidPdf(buffer: Buffer, minBytes: number) {
  assert.ok(Buffer.isBuffer(buffer), "generateReportPDF must return a Buffer");
  assert.ok(buffer.length >= minBytes, `expected >= ${minBytes} bytes, got ${buffer.length}`);
  const head = buffer.subarray(0, 8).toString("latin1");
  assert.match(head, /^%PDF-1\.\d/, `PDF must start with the %PDF- magic header, got ${JSON.stringify(head)}`);
  const tail = buffer.subarray(-1024).toString("latin1");
  assert.match(tail, /%%EOF/, "PDF must end with the %%EOF trailer");
}

test("generateReportPDF: minimal data (no findings/coverage/roadmap) still renders a structurally valid PDF", async () => {
  const buffer = await generateReportPDF(minimalReportData());
  assertValidPdf(buffer, 300);
});

test("generateReportPDF: full data renders a larger, structurally valid multi-page PDF", async () => {
  const minimal = await generateReportPDF(minimalReportData());
  const full = await generateReportPDF(fullReportData());
  assertValidPdf(full, 300);
  // The roadmap section forces a second page (see report-pdf-document.tsx) —
  // more content and an extra page must produce a strictly larger artifact
  // than the single-page minimal case, not a byte-identical placeholder.
  assert.ok(
    full.length > minimal.length,
    `full-data PDF (${full.length}b) should be larger than minimal (${minimal.length}b)`
  );
});

test("generateReportPDF: accepts white-label branding without throwing", async () => {
  const buffer = await generateReportPDF(fullReportData(), { name: "Client Agency", color: "#22c55e" });
  assertValidPdf(buffer, 300);
});

test("renderReportPdf (deep-report Playwright path): returns null, not a fake PDF, when unconfigured", async () => {
  const prevEnabled = process.env.ENABLE_AI_UI_CAPTURE;
  const prevUrl = process.env.AI_UI_CAPTURE_URL;
  delete process.env.ENABLE_AI_UI_CAPTURE;
  delete process.env.AI_UI_CAPTURE_URL;
  try {
    assert.equal(hasAiUiCapture(), false);
    const result = await renderReportPdf("<html><body>test</body></html>");
    // This null is exactly what saveIntelligenceReportArtifacts() /
    // saveReportArtifacts() key their `pdf_degraded` flag on — it must never
    // silently become a truthy placeholder buffer.
    assert.equal(result, null);
  } finally {
    if (prevEnabled === undefined) delete process.env.ENABLE_AI_UI_CAPTURE;
    else process.env.ENABLE_AI_UI_CAPTURE = prevEnabled;
    if (prevUrl === undefined) delete process.env.AI_UI_CAPTURE_URL;
    else process.env.AI_UI_CAPTURE_URL = prevUrl;
  }
});
