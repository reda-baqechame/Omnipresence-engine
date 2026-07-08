import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Patch G (PresenceData OS consolidation): pins that the single documented
 * import surface actually re-exports all five pillars described in
 * docs/PRESENCEDATA_OS.md, and that it does so WITHOUT duplicating any
 * logic — every export here must be the exact same function reference as
 * the one in its real owning file, not a copy/reimplementation.
 */

const presenceData = await import("../index.ts");
const router = await import("@/lib/providers/router");
const capabilities = await import("@/lib/config/capabilities");
const envelope = await import("@/lib/providers/envelope");
const provenance = await import("@/lib/engines/provenance");
const costGuard = await import("@/lib/providers/cost-guard");
const externalApiGuard = await import("@/lib/providers/external-api-guard");
const keywordCpcCache = await import("@/lib/providers/keyword-cpc-cache");
const evidence = await import("@/lib/engines/evidence");

test("presence-data surface exposes exactly the five documented pillars (as namespaces)", () => {
  assert.deepEqual(
    Object.keys(presenceData).sort(),
    ["capabilities", "costGuard", "envelope", "evidence", "externalApiGuard", "keywordCpcCache", "provenance", "router"].sort()
  );
});

test("presence-data.router is the real router.ts module, not a copy", () => {
  assert.equal(presenceData.router.rankedAdapters, router.rankedAdapters);
  assert.equal(presenceData.router.describeProviders, router.describeProviders);
});

test("presence-data.capabilities is the real capabilities.ts module, not a copy", () => {
  assert.equal(presenceData.capabilities.isZeroPaidKeysMode, capabilities.isZeroPaidKeysMode);
});

test("presence-data.envelope is the real envelope.ts module, not a copy", () => {
  assert.equal(presenceData.envelope.buildProviderEnvelope, envelope.buildProviderEnvelope);
});

test("presence-data.provenance is the real provenance.ts module, not a copy", () => {
  assert.equal(presenceData.provenance.provenanceLabel, provenance.provenanceLabel);
  assert.equal(presenceData.provenance.isMeasured, provenance.isMeasured);
});

test("presence-data.costGuard is the real cost-guard.ts module, not a copy", () => {
  assert.equal(presenceData.costGuard.assertWithinBudget, costGuard.assertWithinBudget);
  assert.equal(presenceData.costGuard.recordSpend, costGuard.recordSpend);
});

test("presence-data.externalApiGuard is the real external-api-guard.ts module, not a copy", () => {
  assert.equal(presenceData.externalApiGuard.assertWithinExternalApiBudget, externalApiGuard.assertWithinExternalApiBudget);
});

test("presence-data.keywordCpcCache is the real keyword-cpc-cache.ts module, not a copy", () => {
  assert.equal(presenceData.keywordCpcCache.getCachedRealKeywordCpc, keywordCpcCache.getCachedRealKeywordCpc);
});

test("presence-data.evidence is the real evidence.ts module, not a copy", () => {
  assert.equal(presenceData.evidence.recordMeasurementEvidence, evidence.recordMeasurementEvidence);
});
