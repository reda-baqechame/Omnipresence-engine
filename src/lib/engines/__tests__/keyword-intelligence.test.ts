import { test } from "node:test";
import assert from "node:assert/strict";
import { getReportPreset, REPORT_PRESETS } from "../report-presets.ts";

/**
 * Keyword intelligence network calls are integration-tested via OmniData;
 * this file locks the report/keyword preset contracts used by the intelligence UI.
 */

test("report presets include all professional audit types from the build plan", () => {
  const ids = REPORT_PRESETS.map((p) => p.id);
  for (const required of [
    "executive_audit",
    "technical_seo",
    "keyword_demand",
    "competitive_intel",
    "backlink_authority",
    "local_seo",
    "aeo_geo",
    "attribution_roi",
  ]) {
    assert.ok(ids.includes(required), `missing preset ${required}`);
  }
});

test("deep presets ship non-empty section lists", () => {
  for (const preset of REPORT_PRESETS.filter((p) => p.reportType === "deep")) {
    assert.ok(preset.sections.length > 0, `${preset.id} must define sections`);
    assert.ok(preset.sections.includes("methodology"), `${preset.id} needs methodology`);
  }
});

test("getReportPreset resolves by id", () => {
  const p = getReportPreset("aeo_geo");
  assert.ok(p);
  assert.equal(p?.name, "AI Visibility / AEO-GEO");
});
