import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Patch C (deep-report cancellation checkpoints): a hostile audit found that
 * gatherIntelligenceReport()'s intelligence-gathering fan-out was a single
 * unbounded `Promise.all([...])` over ~16 provider/DB calls with NO
 * cancellation checks at all inside it — a user who clicked Stop after the
 * fan-out started still had every already-dispatched call run to completion
 * (and got billed for it), even though finalizeIntelligenceReport()'s
 * existing checkpoints correctly stopped the *narrative/PDF* half of the
 * pipeline from producing a final "ready" report.
 *
 * These tests exercise the REAL `runCancellableSteps` bounded-concurrency
 * runner and the REAL `gatherIntelligenceReport()` fan-out (with its
 * provider/DB dependencies replaced via node:test's mock.module(), never via
 * source-text assertions) and would FAIL against the old unbounded
 * Promise.all implementation, which had no `isCancelled` parameter and no
 * way to stop scheduling steps mid-flight at all.
 *
 * This file intentionally has NO static imports of production modules
 * (besides node:test/assert) so every mock.module() call below is
 * guaranteed to run before intelligence-report-builder.ts (and its
 * transitive provider/engine imports) are ever loaded.
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CallLog {
  started: string[];
  completed: string[];
}

function makeCallLog(): CallLog {
  return { started: [], completed: [] };
}

// Reassigned by each test before calling gatherIntelligenceReport/
// runCancellableSteps, read live (via closure) by every mock below.
let activeCallLog: CallLog = makeCallLog();

/** Records a call as started immediately, resolves after `ms`, then records completion. */
function tracked<T>(name: string, ms: number, value: T): Promise<T> {
  activeCallLog.started.push(name);
  return delay(ms).then(() => {
    activeCallLog.completed.push(name);
    return value;
  });
}

function arrayChain<T>(table: string, rows: T[]) {
  const chain = {
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    order() {
      return chain;
    },
    limit() {
      return chain;
    },
    gte() {
      return chain;
    },
    lte() {
      return chain;
    },
    then(resolve: (v: { data: T[] }) => void) {
      activeCallLog.started.push(table);
      resolve({ data: rows });
    },
  };
  return chain;
}

function singleChain<T>(table: string, row: T | null) {
  const chain = {
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    order() {
      return chain;
    },
    limit() {
      return chain;
    },
    async single() {
      activeCallLog.started.push(table);
      return { data: row };
    },
    async maybeSingle() {
      activeCallLog.started.push(table);
      return { data: row };
    },
  };
  return chain;
}

const PROJECT_ROW = {
  id: "proj-1",
  organization_id: "org-1",
  name: "Acme Roofing Co",
  domain: "acmeroofing.com",
  competitors: [] as string[],
  location: "Austin, TX",
  status: "active",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const SCORE_ROW = {
  id: "score-1",
  project_id: "proj-1",
  omnipresence_score: 55,
  ai_visibility: 40,
  search_visibility: 60,
  local_visibility: 50,
  social_presence: 45,
  directory_coverage: 70,
  authority_mentions: 35,
  technical_readiness: 65,
  conversion_readiness: 55,
  created_at: "2026-01-15T00:00:00.000Z",
};

/** Real supabase-query surface touched by gatherReportData()/gatherIntelligenceReport(). */
function stubSupabase() {
  return {
    from(table: string) {
      switch (table) {
        case "projects":
          return singleChain(table, PROJECT_ROW);
        case "scores":
          return arrayChain(table, [SCORE_ROW]);
        case "technical_findings":
          return arrayChain(table, []);
        case "coverage_items":
          return arrayChain(table, []);
        case "authority_opportunities":
          return arrayChain(table, []);
        case "roadmaps":
          return singleChain(table, null);
        case "visibility_results":
          return arrayChain(table, []);
        case "attribution_metrics":
          return singleChain(table, null);
        case "organizations":
          return singleChain(table, null);
        case "rank_keywords":
          return arrayChain(table, []);
        case "keyword_opportunities":
          return arrayChain(table, []);
        case "schema_deployments":
          return arrayChain(table, []);
        case "cwv_history":
          return singleChain(table, null);
        case "community_mentions":
          return arrayChain(table, []);
        default:
          throw new Error(`unexpected table in fan-out cancellation test stub: ${table}`);
      }
    },
  };
}

const DELAY_MS = 15;

function honestVisibilitySnapshotFixture() {
  return {
    scopedResults: [],
    groundedResults: [],
    metrics: { mentionRate: 0, citationRate: 0, sampleSize: 0 },
    sov: {},
    attempted: 0,
    groundedCount: 0,
    modelKnowledgeCount: 0,
    unavailableCount: 0,
    groundedRate: 0,
    ratesReliable: false,
    reliabilityNote: null,
    latestRun: null,
    allResults: [],
    runs: [],
  };
}

mock.module("@/lib/engines/visibility-scope", {
  namedExports: {
    loadProjectVisibilitySnapshot: () =>
      tracked("loadProjectVisibilitySnapshot", DELAY_MS, honestVisibilitySnapshotFixture()),
  },
});
mock.module("@/lib/engines/competitive-snapshot", {
  namedExports: {
    getCompetitiveSnapshot: () => tracked("getCompetitiveSnapshot", DELAY_MS, null),
  },
});
mock.module("@/lib/engines/popularity-signal", {
  namedExports: {
    getPopularitySignal: () => tracked("getPopularitySignal", DELAY_MS, null),
  },
});
mock.module("@/lib/providers/backlinks-free", {
  namedExports: {
    getBacklinksFree: () => tracked("getBacklinksFree", DELAY_MS, null),
  },
});
mock.module("@/lib/providers/domain-authority", {
  namedExports: {
    resolveDomainAuthority: () => tracked("resolveDomainAuthority", DELAY_MS, null),
  },
});
mock.module("@/lib/engines/proof-report", {
  namedExports: {
    buildProofReport: () => tracked("buildProofReport", DELAY_MS, null),
    renderProofHTML: () => "<html></html>",
  },
});
mock.module("@/lib/engines/results-ledger", {
  namedExports: {
    getLedgerForProject: () => tracked("getLedgerForProject", DELAY_MS, []),
  },
});
mock.module("@/lib/engines/local-listings", {
  namedExports: {
    verifyLocalPresence: () => tracked("verifyLocalPresence", DELAY_MS, []),
  },
});
mock.module("@/lib/engines/entity-engine", {
  namedExports: {
    buildEntityProfile: () => tracked("buildEntityProfile", DELAY_MS, null),
  },
});
mock.module("@/lib/engines/source-graph", {
  namedExports: {
    getSourceGraph: () => tracked("getSourceGraph", DELAY_MS, null),
  },
});

const { runCancellableSteps, gatherIntelligenceReport } = await import("../intelligence-report-builder.ts");

// ---------------------------------------------------------------------------
// Test 1 — the generic runner stops queued steps once cancellation fires.
// ---------------------------------------------------------------------------

test("runCancellableSteps: cancellation stops queued-but-not-started steps (concurrency 2, 6 steps)", async () => {
  const started: string[] = [];
  const completed: string[] = [];
  let cancelNow = false;

  const steps = Array.from({ length: 6 }, (_, i) => ({
    name: `step-${i + 1}`,
    run: async () => {
      started.push(`step-${i + 1}`);
      await delay(10);
      completed.push(`step-${i + 1}`);
      // Flip the cancellation flag once the FIRST step finishes.
      if (`step-${i + 1}` === "step-1") cancelNow = true;
      return i;
    },
  }));

  const result = await runCancellableSteps({
    steps,
    concurrency: 2,
    isCancelled: async () => cancelNow,
  });

  assert.equal(result.cancelled, true, "the run must report cancelled: true");
  // With concurrency 2: step-1 and step-2 are claimed before anything
  // completes, so both start; step-1 completing flips cancelNow, so step-3
  // onward must never start.
  assert.deepEqual(started, ["step-1", "step-2"], "steps 3-6 must never have started");
  assert.ok(completed.includes("step-1"), "step-1 (already in-flight) is allowed to finish");
  assert.deepEqual(
    [...result.skippedSteps].sort(),
    ["step-3", "step-4", "step-5", "step-6"],
    "steps 3-6 must be recorded as skipped"
  );
  assert.ok(!result.skippedSteps.includes("step-1"));
  assert.ok(!result.skippedSteps.includes("step-2"));
});

test("runCancellableSteps: never cancelled — every step runs and results are captured", async () => {
  const steps = Array.from({ length: 5 }, (_, i) => ({
    name: `s${i}`,
    run: async () => `result-${i}`,
  }));

  const result = await runCancellableSteps({
    steps,
    concurrency: 3,
    isCancelled: async () => false,
  });

  assert.equal(result.cancelled, false);
  assert.equal(result.completedSteps.length, 5);
  assert.equal(result.skippedSteps.length, 0);
  assert.equal(result.results.s0, "result-0");
  assert.equal(result.results.s4, "result-4");
});

test("runCancellableSteps: a step that throws is recorded in failedSteps without stopping other steps", async () => {
  const steps = [
    { name: "ok-1", run: async () => "fine" },
    {
      name: "boom",
      run: async () => {
        throw new Error("provider exploded");
      },
    },
    { name: "ok-2", run: async () => "also fine" },
  ];

  const result = await runCancellableSteps({
    steps,
    concurrency: 3,
    isCancelled: async () => false,
  });

  assert.equal(result.cancelled, false);
  assert.deepEqual([...result.completedSteps].sort(), ["ok-1", "ok-2"]);
  assert.deepEqual(result.failedSteps, ["boom"]);
  assert.equal(result.results.boom, undefined);
});

// ---------------------------------------------------------------------------
// Patch D: onStepStart/onStepComplete were unused hooks on runCancellableSteps
// before this patch — gatherIntelligenceReport() now forwards its own
// opts.onStepStart/onStepComplete straight into them (see the real progress
// writer wired up in report-builder.ts's saveIntelligenceReportArtifacts).
// These two tests pin the runner's own hook-invocation contract directly,
// independent of the DB-writing tracker (already covered by
// job-progress.test.ts) or the full gather fan-out (heavy engine mocking,
// out of scope here).
// ---------------------------------------------------------------------------

test("runCancellableSteps: onStepStart/onStepComplete fire for every step that actually runs, and never for a skipped one", async () => {
  const starts: string[] = [];
  const completes: string[] = [];
  let cancelNow = false;

  const steps = Array.from({ length: 4 }, (_, i) => ({
    name: `step-${i + 1}`,
    run: async () => {
      await delay(5);
      if (`step-${i + 1}` === "step-1") cancelNow = true;
      return i;
    },
  }));

  const result = await runCancellableSteps({
    steps,
    concurrency: 1, // serialize so the skip point is deterministic
    isCancelled: async () => cancelNow,
    onStepStart: (name) => {
      starts.push(name);
    },
    onStepComplete: (name) => {
      completes.push(name);
    },
  });

  assert.equal(result.cancelled, true);
  assert.deepEqual(starts, ["step-1"], "onStepStart must fire only for the one step that actually ran");
  assert.deepEqual(completes, ["step-1"], "onStepComplete must fire only for the one step that actually completed");
  assert.ok(!starts.includes("step-2"), "a skipped step must never get an onStepStart call");
});

test("runCancellableSteps: onStepStart/onStepComplete are entirely optional — omitting them changes nothing about execution", async () => {
  const steps = [
    { name: "a", run: async () => "ok-a" },
    { name: "b", run: async () => "ok-b" },
  ];

  const result = await runCancellableSteps({ steps, concurrency: 2, isCancelled: async () => false });

  assert.equal(result.cancelled, false);
  assert.deepEqual([...result.completedSteps].sort(), ["a", "b"]);
});

// ---------------------------------------------------------------------------
// Tests 2-4 — gatherIntelligenceReport() itself uses the runner correctly.
// ---------------------------------------------------------------------------

test("gatherIntelligenceReport: cancellation mid-fan-out stops later named steps from ever starting", async () => {
  activeCallLog = makeCallLog();
  const supabase = stubSupabase();

  const result = await gatherIntelligenceReport(supabase as never, "proj-1", {
    // Flips true only once the FIRST-scheduled step (ai_visibility) finishes —
    // by then, competitor_analysis and backlink_analysis (concurrency 3) are
    // already in flight and must be allowed to finish, but nothing after them
    // may ever start.
    isCancelled: async () => activeCallLog.completed.includes("loadProjectVisibilitySnapshot"),
  });

  assert.ok(result, "gatherIntelligenceReport must not return null for a project that exists");
  assert.equal(result!.cancelled, true, "result must report cancelled: true");
  assert.ok(!("report" in result! && result.report), "a cancelled result must never carry a final report");

  // Proof queued steps never started: none of the calls unique to
  // serp_analysis / keyword_analysis / technical_audit / local_analysis /
  // analytics_attribution appear anywhere in the started log.
  const neverStarted = [
    "getPopularitySignal",
    "keyword_opportunities",
    "schema_deployments",
    "verifyLocalPresence",
    "community_mentions",
    "getLedgerForProject",
    "getSourceGraph",
    "buildEntityProfile",
  ];
  for (const name of neverStarted) {
    assert.ok(
      !activeCallLog.started.includes(name),
      `${name} must never be called once cancellation was observed mid-fan-out`
    );
  }
  // rank_keywords IS touched once by gatherReportData()'s unrelated
  // striking-keywords lookup (which runs before the fan-out even begins) —
  // it must NOT be touched a second time by the (skipped) serp_analysis step.
  assert.equal(
    activeCallLog.started.filter((n) => n === "rank_keywords").length,
    1,
    "rank_keywords must be queried exactly once (gatherReportData only) — serp_analysis must not also query it"
  );
  // buildProofReport is also called once, unconditionally, by
  // gatherReportData() before the fan-out — analytics_attribution's own call
  // must not add a second invocation once cancelled.
  assert.equal(
    activeCallLog.started.filter((n) => n === "buildProofReport").length,
    1,
    "buildProofReport must not be invoked a second time by the (skipped) analytics_attribution step"
  );

  // Proof already-in-flight calls WERE allowed to start (and finish):
  assert.ok(activeCallLog.started.includes("loadProjectVisibilitySnapshot"));
  assert.ok(activeCallLog.started.includes("getCompetitiveSnapshot"));
  assert.ok(activeCallLog.started.includes("getBacklinksFree"));
  assert.ok(activeCallLog.started.includes("resolveDomainAuthority"));
});

test("gatherIntelligenceReport: cost/call-count does not grow after the cancellation checkpoint", async () => {
  activeCallLog = makeCallLog();
  const supabase = stubSupabase();

  await gatherIntelligenceReport(supabase as never, "proj-1", {
    isCancelled: async () => activeCallLog.completed.includes("loadProjectVisibilitySnapshot"),
  });

  const startedAtReturnTime = activeCallLog.started.length;

  // Give any (incorrectly) still-scheduled work a chance to fire.
  await delay(DELAY_MS * 3);

  assert.equal(
    activeCallLog.started.length,
    startedAtReturnTime,
    "no new provider/DB calls may start after gatherIntelligenceReport() has returned a cancelled result"
  );
});

test("gatherIntelligenceReport: not cancelled — every named step runs and a full report is returned", async () => {
  activeCallLog = makeCallLog();
  const supabase = stubSupabase();

  const result = await gatherIntelligenceReport(supabase as never, "proj-1", {
    isCancelled: async () => false,
  });

  assert.ok(result);
  assert.equal(result!.cancelled, false);
  assert.ok("report" in result! && result.report, "an uncancelled gather must return a report");

  const expectedCalls = [
    "loadProjectVisibilitySnapshot",
    "getCompetitiveSnapshot",
    "getPopularitySignal",
    "getBacklinksFree",
    "resolveDomainAuthority",
    "verifyLocalPresence",
    "getLedgerForProject",
    "getSourceGraph",
    "buildEntityProfile",
  ];
  for (const name of expectedCalls) {
    assert.ok(activeCallLog.completed.includes(name), `${name} must be called on the normal (uncancelled) path`);
  }
  // Both gatherReportData()'s unconditional query AND serp_analysis's own
  // query must fire when nothing was cancelled.
  assert.equal(activeCallLog.started.filter((n) => n === "rank_keywords").length, 2);
  assert.equal(activeCallLog.started.filter((n) => n === "buildProofReport").length, 2);
  assert.ok(activeCallLog.started.includes("keyword_opportunities"));
  assert.ok(activeCallLog.started.includes("schema_deployments"));
  assert.ok(activeCallLog.started.includes("community_mentions"));

  const report = (result as { report: { meta: { reportType: string } } }).report;
  assert.equal(report.meta.reportType, "deep");
});

test("gatherIntelligenceReport: forwards onStepStart/onStepComplete for every named gather step (Patch D wiring)", async () => {
  activeCallLog = makeCallLog();
  const supabase = stubSupabase();
  const starts: string[] = [];
  const completes: string[] = [];

  const result = await gatherIntelligenceReport(supabase as never, "proj-1", {
    isCancelled: async () => false,
    onStepStart: (name) => {
      starts.push(name);
    },
    onStepComplete: (name) => {
      completes.push(name);
    },
  });

  assert.ok(result && !result.cancelled);
  const expectedSteps = [
    "ai_visibility",
    "competitor_analysis",
    "backlink_analysis",
    "serp_analysis",
    "keyword_analysis",
    "technical_audit",
    "local_analysis",
    "analytics_attribution",
  ];
  for (const name of expectedSteps) {
    assert.ok(starts.includes(name), `onStepStart must fire for ${name}`);
    assert.ok(completes.includes(name), `onStepComplete must fire for ${name}`);
  }
  assert.equal(starts.length, 8);
  assert.equal(completes.length, 8);
});

test("gatherIntelligenceReport: onStepStart/onStepComplete are optional — omitting them is unchanged, backward-compatible behavior", async () => {
  activeCallLog = makeCallLog();
  const supabase = stubSupabase();

  const result = await gatherIntelligenceReport(supabase as never, "proj-1", {
    isCancelled: async () => false,
  });

  assert.ok(result && !result.cancelled, "must still succeed with no progress hooks attached");
});

test("gatherIntelligenceReport: cancellation before gathering starts skips the entire fan-out", async () => {
  activeCallLog = makeCallLog();
  const supabase = stubSupabase();

  const result = await gatherIntelligenceReport(supabase as never, "proj-1", {
    isCancelled: async () => true,
  });

  assert.ok(result);
  assert.equal(result!.cancelled, true);
  const namedStepCalls = [
    "loadProjectVisibilitySnapshot",
    "getCompetitiveSnapshot",
    "getPopularitySignal",
    "getBacklinksFree",
    "resolveDomainAuthority",
    "verifyLocalPresence",
    "getLedgerForProject",
    "getSourceGraph",
    "buildEntityProfile",
  ];
  for (const name of namedStepCalls) {
    assert.ok(!activeCallLog.started.includes(name), `${name} must never be called when already cancelled before gather starts`);
  }
});
