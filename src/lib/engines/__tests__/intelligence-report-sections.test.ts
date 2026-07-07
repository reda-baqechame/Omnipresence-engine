import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSectionsIncluded,
  applySectionSelection,
} from "../report-section-selection.ts";
import { ALL_INTELLIGENCE_SECTIONS } from "@/types/intelligence-report.ts";
import type { IntelligenceReport } from "@/types/intelligence-report.ts";

/**
 * P0 #9: `reports.sections` was persisted from the generate-report form but
 * never read back — every deep report always rendered all 16 sections
 * regardless of the preset selected. These tests pin the fix at the two
 * seams that matter: resolving the requested list into what actually gets
 * force-included, and applying that selection onto an assembled report so
 * excluded sections are marked unavailable (not silently rendered anyway).
 */

test("resolveSectionsIncluded: empty/omitted selection means everything", () => {
  assert.deepEqual(new Set(resolveSectionsIncluded(undefined)), new Set(ALL_INTELLIGENCE_SECTIONS));
  assert.deepEqual(new Set(resolveSectionsIncluded([])), new Set(ALL_INTELLIGENCE_SECTIONS));
});

test("resolveSectionsIncluded: honors a narrow custom selection", () => {
  const result = resolveSectionsIncluded(["keywords", "roadmap"]);
  assert.ok(result.includes("keywords"));
  assert.ok(result.includes("roadmap"));
  assert.ok(!result.includes("backlinks"));
  assert.ok(!result.includes("visibility"));
});

test("resolveSectionsIncluded: always force-includes executive and methodology", () => {
  const result = resolveSectionsIncluded(["keywords"]);
  assert.ok(result.includes("executive"));
  assert.ok(result.includes("methodology"));
});

test("resolveSectionsIncluded: de-duplicates when caller already included structural sections", () => {
  const result = resolveSectionsIncluded(["executive", "methodology", "keywords"]);
  assert.equal(result.filter((s) => s === "executive").length, 1);
  assert.equal(result.filter((s) => s === "methodology").length, 1);
});

function fakeMeta() {
  return { available: true, dataQuality: "measured" as const };
}

function fakeReport(): IntelligenceReport {
  // Minimal stand-in — only the SectionMeta fields applySectionSelection
  // touches are exercised, the rest are cast through unknown for brevity.
  const sections = Object.fromEntries(ALL_INTELLIGENCE_SECTIONS.map((id) => [id, fakeMeta()]));
  return {
    ...sections,
    coverageItems: [],
    authorityOpportunities: [],
    score: {} as never,
    visibilityResults: [],
  } as unknown as IntelligenceReport;
}

test("applySectionSelection: marks unselected sections unavailable even if their data was gathered", () => {
  const report = fakeReport();
  assert.equal(report.backlinks.available, true);
  assert.equal(report.keywords.available, true);

  applySectionSelection(report, resolveSectionsIncluded(["keywords"]));

  assert.equal(report.keywords.available, true, "selected section stays as gathered");
  assert.equal(report.backlinks.available, false, "unselected section is forced unavailable");
  assert.match(report.backlinks.note || "", /excluded/i);
});

test("applySectionSelection: never touches executive/methodology (always structural)", () => {
  const report = fakeReport();
  applySectionSelection(report, resolveSectionsIncluded(["keywords"]));
  assert.equal(report.executive.available, true);
  assert.equal(report.methodology.available, true);
});

test("applySectionSelection: full selection (default) leaves every section untouched", () => {
  const report = fakeReport();
  applySectionSelection(report, resolveSectionsIncluded(undefined));
  for (const id of ALL_INTELLIGENCE_SECTIONS) {
    assert.equal(report[id].available, true, `${id} should remain available`);
  }
});
