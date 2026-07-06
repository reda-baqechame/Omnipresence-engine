import { test } from "node:test";
import assert from "node:assert/strict";
import { REPORT_PRESETS } from "../report-presets.ts";

/**
 * Source influence scoring requires Supabase fixtures; this test locks the
 * influence-related report preset and ensures AEO report surfaces source graph.
 */

test("AEO/GEO preset includes visibility and proof sections for source influence", () => {
  const aeo = REPORT_PRESETS.find((p) => p.id === "aeo_geo");
  assert.ok(aeo);
  assert.ok(aeo!.sections.includes("visibility"));
  assert.ok(aeo!.sections.includes("proof"));
});

test("backlink authority preset prioritizes outreach-oriented sections", () => {
  const bl = REPORT_PRESETS.find((p) => p.id === "backlink_authority");
  assert.ok(bl);
  assert.ok(bl!.sections.includes("backlinks"));
  assert.ok(bl!.sections.includes("community"));
});
