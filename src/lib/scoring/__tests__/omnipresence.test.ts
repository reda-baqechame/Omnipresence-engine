import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateOmniPresenceScore, getScoreLabel } from "../omnipresence.ts";
import type { VisibilityResult, CoverageItem } from "@/types/database";

/**
 * Refund-critical scoring invariants for the OmniPresence score:
 *  - a dimension we could NOT measure must never be scored as 0 (no false
 *    "Invisible" verdict); weights re-normalize over measured dimensions.
 *  - demo/simulated rows must never inflate a real score, and provenance must
 *    report the honest data_source.
 *  - confidence == measured/total inputs.
 */

function vis(overrides: Partial<VisibilityResult>): VisibilityResult {
  return {
    id: "r", run_id: "run", project_id: "p", engine: "chatgpt", prompt_text: "q",
    brand_mentioned: false, brand_cited: false, competitor_mentions: {}, competitor_citations: {},
    source_domains: [], cited_urls: [], data_source: "measured", ...overrides,
  } as VisibilityResult;
}

function cov(overrides: Partial<CoverageItem>): CoverageItem {
  return {
    id: "c", project_id: "p", surface: "linkedin", platform_name: "LinkedIn",
    is_present: false, is_optimized: false, competitor_present: false,
    data_quality: "measured", created_at: "", updated_at: "", ...overrides,
  } as CoverageItem;
}

test("unmeasured dimensions are excluded — no false Invisible zero for a strong brand", () => {
  // Only AI visibility measured (brand strongly present); everything else absent.
  // (No source_domains, so the authority dimension also stays unmeasured — this
  // isolates the re-normalization invariant.)
  const score = calculateOmniPresenceScore({
    visibilityResults: [
      vis({ engine: "chatgpt", brand_mentioned: true, brand_cited: true }),
      vis({ engine: "perplexity", brand_mentioned: true, brand_cited: true }),
    ],
    technicalFindings: [],
    coverageItems: [],
    authorityOpportunities: [],
    hasConversionTracking: false,
    hasGbp: false,
  });
  // AI visibility is perfect (100). With re-normalization over only the measured
  // dimensions (ai + always-on technical/conversion) the score is high (~67.5),
  // NOT dragged toward "Weak" (~27) as it would be if unmeasured search/local/
  // social/directory/authority were scored as 0.
  assert.ok(score.omnipresence_score >= 60, `expected strong score, got ${score.omnipresence_score}`);
  assert.equal(score.breakdown.dimension_availability.search_visibility, false);
  assert.equal(score.breakdown.dimension_availability.ai_visibility, true);
  assert.equal(score.breakdown.dimension_availability.authority_mentions, false);
  // Only ai(0.20) + technical(0.10) + conversion(0.10) measured → coverage 0.40.
  assert.equal(score.breakdown.dimension_coverage, 0.4);
});

test("simulated-only data never reports as measured and is flagged demo", () => {
  const score = calculateOmniPresenceScore({
    visibilityResults: [
      vis({ engine: "chatgpt", brand_mentioned: true, data_source: "simulated" }),
    ],
    technicalFindings: [],
    coverageItems: [],
    authorityOpportunities: [],
    hasConversionTracking: false,
    hasGbp: false,
  });
  assert.equal(score.data_source, "simulated");
  assert.equal(score.measured_inputs, 0);
  assert.equal(score.confidence, 0);
});

test("unavailable rows do not count and do not inflate (no false zero, no fake data)", () => {
  const score = calculateOmniPresenceScore({
    visibilityResults: [
      vis({ engine: "chatgpt", brand_mentioned: true, data_source: "unavailable" }),
    ],
    technicalFindings: [],
    coverageItems: [],
    authorityOpportunities: [],
    hasConversionTracking: false,
    hasGbp: false,
  });
  // The single AI row is unavailable → AI dimension not measured. Only the
  // always-on technical/conversion dimensions remain.
  assert.equal(score.breakdown.dimension_availability.ai_visibility, false);
  assert.equal(score.measured_inputs, 0);
  assert.equal(score.data_source, "unavailable");
});

test("confidence equals measured/total inputs", () => {
  const score = calculateOmniPresenceScore({
    visibilityResults: [
      vis({ engine: "chatgpt", brand_mentioned: true, data_source: "measured" }),
      vis({ engine: "perplexity", brand_mentioned: true, data_source: "unavailable" }),
    ],
    technicalFindings: [],
    coverageItems: [],
    authorityOpportunities: [],
    hasConversionTracking: false,
    hasGbp: false,
  });
  assert.equal(score.confidence, 0.5);
  assert.equal(score.total_inputs, 2);
  assert.equal(score.measured_inputs, 1);
});

test("grounded measured data reports data_source=measured", () => {
  const score = calculateOmniPresenceScore({
    visibilityResults: [vis({ engine: "chatgpt", brand_mentioned: true, data_source: "measured" })],
    technicalFindings: [],
    coverageItems: [cov({ surface: "linkedin", is_present: true, is_optimized: true })],
    authorityOpportunities: [],
    hasConversionTracking: true,
    hasGbp: false,
  });
  assert.equal(score.data_source, "measured");
  assert.ok(score.omnipresence_score > 0);
});

test("score labels follow documented thresholds", () => {
  assert.equal(getScoreLabel(85).label, "Dominant");
  assert.equal(getScoreLabel(65).label, "Strong");
  assert.equal(getScoreLabel(45).label, "Moderate");
  assert.equal(getScoreLabel(25).label, "Weak");
  assert.equal(getScoreLabel(5).label, "Invisible");
});
