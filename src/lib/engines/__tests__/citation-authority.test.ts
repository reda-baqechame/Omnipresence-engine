import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "../source-graph.ts";
import { getCoverageGaps } from "../coverage-checker.ts";
import type { CoverageItem } from "@/types/database";

/**
 * Citation/authority/coverage features must never fabricate presence and must
 * classify prompt intent correctly (it weights source influence). These exercise
 * the REAL exported logic through the resolver+framework-stub hook.
 */

test("classifyIntent maps prompts to the correct buyer-journey intent", () => {
  assert.equal(classifyIntent("best crm software for startups"), "commercial");
  assert.equal(classifyIntent("buy hubspot pricing discount"), "transactional");
  assert.equal(classifyIntent("hubspot login official site"), "navigational");
  assert.equal(classifyIntent("what is a crm"), "informational");
});

test("getCoverageGaps returns only true gaps (missing OR competitor-present)", () => {
  const items = [
    { surface: "g2", is_present: true, competitor_present: false },
    { surface: "reddit", is_present: false, competitor_present: false },
    { surface: "capterra", is_present: true, competitor_present: true },
  ] as unknown as CoverageItem[];

  const gaps = getCoverageGaps(items);
  const surfaces = gaps.map((g) => g.surface);
  assert.ok(!surfaces.includes("g2"), "present + no competitor is NOT a gap");
  assert.ok(surfaces.includes("reddit"), "absent surface IS a gap");
  assert.ok(surfaces.includes("capterra"), "competitor-present surface IS a gap to close");
  assert.equal(gaps.length, 2);
});

test("getCoverageGaps on all-present data returns no fabricated gaps", () => {
  const items = [
    { surface: "g2", is_present: true, competitor_present: false },
    { surface: "trustpilot", is_present: true, competitor_present: false },
  ] as unknown as CoverageItem[];
  assert.equal(getCoverageGaps(items).length, 0);
});
