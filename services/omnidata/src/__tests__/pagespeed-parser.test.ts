import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePageSpeedResponse } from "../engines/pagespeed.js";

/**
 * Offline accuracy audit for the PageSpeed/CrUX PARSER (parsePageSpeedResponse):
 * given a known PSI v5 JSON payload, it must extract the lab performance score
 * (0-1 → 0-100), Core Web Vitals (LCP/CLS/TBT), real-user CrUX field data, and
 * correctly label data_source (pagespeed_with_crux vs lab_only) — never a
 * confident zero when the payload lacks a score. Zero network; fixtures only.
 */

const fastWithCrux = {
  lighthouseResult: {
    categories: { performance: { score: 0.97 } },
    audits: {
      "largest-contentful-paint": { numericValue: 1180.4 },
      "cumulative-layout-shift": { numericValue: 0.018 },
      "total-blocking-time": { numericValue: 90.2 },
    },
  },
  loadingExperience: {
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 1900, category: "FAST" },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: "FAST" },
      INTERACTION_TO_NEXT_PAINT: { percentile: 140, category: "FAST" },
    },
    overall_category: "FAST",
  },
  originLoadingExperience: {
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2000 },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 6 },
      INTERACTION_TO_NEXT_PAINT: { percentile: 150 },
    },
    overall_category: "FAST",
  },
};

const slowLabOnly = {
  lighthouseResult: {
    categories: { performance: { score: 0.32 } },
    audits: {
      "largest-contentful-paint": { numericValue: 6400 },
      "cumulative-layout-shift": { numericValue: 0.41 },
      "total-blocking-time": { numericValue: 920 },
    },
  },
  // No loadingExperience → lab_only.
};

describe("PageSpeed parser — CWV + CrUX extraction (offline)", () => {
  it("parses a fast page with real CrUX field data", () => {
    const r = parsePageSpeedResponse(fastWithCrux, "https://fast.example", "mobile");
    assert.equal(r.available, true);
    assert.equal(r.performance_score, 97); // 0.97 → 97
    assert.equal(r.lcp_ms, 1180); // rounded
    assert.equal(r.cls, 0.018);
    assert.equal(r.tbt_ms, 90);
    assert.equal(r.has_field_data, true);
    assert.equal(r.data_source, "pagespeed_with_crux");
    assert.equal(r.field?.assessment, "good"); // FAST → good
  });

  it("parses a slow page as lab_only when no field data is present", () => {
    const r = parsePageSpeedResponse(slowLabOnly, "https://slow.example", "mobile");
    assert.equal(r.available, true);
    assert.equal(r.performance_score, 32);
    assert.equal(r.lcp_ms, 6400);
    assert.equal(r.cls, 0.41);
    assert.equal(r.has_field_data, false);
    assert.equal(r.data_source, "lab_only");
    assert.equal(r.field, undefined);
  });

  it("reports unavailable (not a confident 0) when the score is missing", () => {
    const r = parsePageSpeedResponse({ lighthouseResult: { audits: {} } }, "https://x.example", "mobile");
    assert.equal(r.available, false);
    assert.equal(r.data_source, "unavailable");
    // Honest: no fabricated metrics.
    assert.equal(r.performance_score, 0);
    assert.ok(r.reason && r.reason.length > 0);
  });
});
