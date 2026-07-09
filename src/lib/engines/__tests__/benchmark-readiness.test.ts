import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBenchmarkReadinessReport } from "../benchmark-readiness.ts";

test("buildBenchmarkReadinessReport never invents evidenceStarted without rows", () => {
  const r = buildBenchmarkReadinessReport({ rowCountLookback: 0, latestRunAt: null });
  assert.equal(r.evidenceStarted, false);
  assert.ok(r.warnings.some((w) => /not started/i.test(w)));
  assert.ok(r.manualTriggerNotes.some((n) => /Never invent/i.test(n)));
});

test("buildBenchmarkReadinessReport marks evidence started when rows exist", () => {
  const r = buildBenchmarkReadinessReport({
    rowCountLookback: 12,
    latestRunAt: "2026-07-09T00:00:00.000Z",
  });
  assert.equal(r.evidenceStarted, true);
});
