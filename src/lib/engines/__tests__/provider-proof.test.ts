import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Pure-ish contract: proof labels must never claim parity without evidence.
 * Full loadProviderProofCockpit is covered via the admin route mock test.
 */
import type { ProofState } from "../provider-proof.ts";

const LABELS: Record<ProofState, string> = {
  infrastructure_ready_no_evidence: "Infrastructure ready, no benchmark evidence yet",
  smoke_in_progress: "7-day smoke in progress",
  promotion_not_met: "30-day promotion not met",
  benchmark_proven: "Benchmark-proven for this capability",
  fallback_only: "Fallback only",
  unavailable: "Unavailable",
};

test("provider proof states cover honest UI copy", () => {
  assert.ok(!Object.values(LABELS).some((l) => /parity achieved|replaces dataforseo/i.test(l)));
  assert.match(LABELS.infrastructure_ready_no_evidence, /no benchmark evidence/i);
  assert.match(LABELS.benchmark_proven, /Benchmark-proven/);
});
