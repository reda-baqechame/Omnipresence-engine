import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Cron/background-job reliability invariants over ALL Inngest functions.
 *
 * These run unattended at scale across every tenant's projects, so a structural
 * defect (duplicate id silently dropping a job, no retries, a per-project step
 * id that collides across projects defeating idempotency/isolation) is a
 * production incident no single feature test would catch. We verify the source
 * statically — robust, fast, and independent of a live Inngest+DB runtime.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "functions.ts"), "utf8");

/** Split the file into one chunk per createFunction call. */
function functionChunks(): string[] {
  return source.split(/inngest\.createFunction\(/).slice(1);
}

function idOf(chunk: string): string | null {
  return chunk.match(/id:\s*"([^"]+)"/)?.[1] ?? null;
}

test("there are many registered jobs and every one declares an id", () => {
  const chunks = functionChunks();
  assert.ok(chunks.length >= 30, `expected 30+ Inngest functions, found ${chunks.length}`);
  for (const c of chunks) assert.ok(idOf(c), "every createFunction must declare an id");
});

test("all function ids are UNIQUE (a duplicate id silently drops a job)", () => {
  const ids = functionChunks().map(idOf).filter(Boolean) as string[];
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, [], `duplicate Inngest ids would clobber jobs: ${dupes.join(", ")}`);
});

test("every job configures retries (resilience to transient upstream failures)", () => {
  for (const c of functionChunks()) {
    const id = idOf(c);
    // retries lives in the config object, before the handler body.
    const head = c.slice(0, c.indexOf("async ("));
    assert.match(head, /retries:\s*\d+/, `job "${id}" must configure retries`);
  }
});

test("per-project loops use a project-scoped step id (idempotency + isolation)", () => {
  // For each job that fans out over projects, the step/event id inside the loop
  // MUST be parameterized by the project so Inngest memoizes per project (one
  // project's failure/replay never collides with or blocks another's).
  const chunks = functionChunks();
  let loopJobs = 0;
  for (const c of chunks) {
    const loopIdx = c.search(/for\s*\(\s*const\s+\w+\s+of\s+project/);
    if (loopIdx === -1) continue;
    loopJobs++;
    const body = c.slice(loopIdx, loopIdx + 700);
    const usesScopedStep =
      /step\.(run|sendEvent|invoke)\(\s*[`"][^`"]*\$\{[^}]*(project|projectId)/.test(body) ||
      /\$\{project(Id|\.id)/.test(body);
    assert.ok(usesScopedStep, `job "${idOf(c)}" fans out over projects but its step id is not project-scoped`);
  }
  assert.ok(loopJobs >= 8, `expected several fan-out cron jobs, found ${loopJobs}`);
});

test("the highest-risk scan job captures failures to APM and un-sticks state", () => {
  const scan = functionChunks().find((c) => idOf(c) === "run-full-scan")!;
  assert.ok(scan, "run-full-scan must exist");
  assert.match(scan, /onFailure:/, "scan must define an onFailure handler");
  assert.match(scan, /captureException\(/, "scan onFailure must capture to APM");
  // un-stick: a scan that exhausts retries resets status so the user can retry.
  assert.match(scan, /status:\s*"active"/, "scan onFailure must reset project status");
});

test("APM capture is imported and used in the jobs module", () => {
  assert.match(source, /import\s*\{[^}]*captureException[^}]*\}\s*from\s*"@\/lib\/observability\/log"/);
  const uses = source.match(/captureException\(/g) || [];
  assert.ok(uses.length >= 2, "expect multiple APM capture points across jobs");
});

test("generate-report checks cancellation before starting AND before the final save, and never produces a report for a cancelled run", () => {
  const gen = functionChunks().find((c) => idOf(c) === "generate-report")!;
  assert.ok(gen, "generate-report job must exist");
  const cancelChecks = gen.match(/check-cancel-before-/g) || [];
  assert.ok(
    cancelChecks.length >= 2,
    "generate-report must check cancellation both before starting generation and again before the final save step"
  );
  assert.match(gen, /status:\s*"cancelled"/, "a cancelled report must be marked cancelled");
  assert.match(gen, /cancelled_at:/, "a cancelled report must record cancelled_at");
  // A cancelled run must return before reaching save-report/save-intelligence-report —
  // i.e. the cancellation branches' `return` must appear before those step names.
  const saveIdx = Math.min(
    ...["save-report", "save-intelligence-report"].map((s) => {
      const i = gen.indexOf(`step.run("${s}"`);
      return i === -1 ? Infinity : i;
    })
  );
  const cancelReturnIdx = gen.indexOf('cancelled: true, reportId };');
  assert.ok(cancelReturnIdx !== -1 && cancelReturnIdx < saveIdx, "cancellation must return before any save step runs");
});

test("run-full-scan checks cancellation between engine batches and skips scoring/finalization when cancelled", () => {
  const scan = functionChunks().find((c) => idOf(c) === "run-full-scan")!;
  assert.ok(scan, "run-full-scan must exist");
  assert.match(scan, /batch\.cancelled/, "run-full-scan must check each engine batch's cancelled flag");
  assert.match(scan, /cancelled:\s*true/, "a cancelled scan must short-circuit before score-roadmap/finalize");
  // score-roadmap/finalize (the expensive scoring + email steps) must be
  // unreachable once the cancelled branch has already returned.
  const cancelReturnIdx = scan.indexOf("return { projectId, cancelled: true }");
  const scoreIdx = scan.indexOf('step.run("score-roadmap"');
  assert.ok(cancelReturnIdx !== -1 && cancelReturnIdx < scoreIdx, "cancellation must return before score-roadmap runs");

  // The actual visibility_runs.status = 'cancelled' write happens in
  // finalizeVisibilityScan (visibility-scan-batches.ts), which run-full-scan
  // calls via the visibility-finalize step.
  const batches = readFileSync(join(here, "..", "..", "engines", "visibility-scan-batches.ts"), "utf8");
  assert.match(batches, /status:\s*"cancelled"/, "finalizeVisibilityScan must mark a cancelled run's status cancelled");
});

test("run-full-scan checks idempotency-key before doing any audit/brand/prompt work, memoized as a step", () => {
  const scan = functionChunks().find((c) => idOf(c) === "run-full-scan")!;
  assert.ok(scan, "run-full-scan must exist");
  const idempIdx = scan.indexOf('step.run("idempotency-check"');
  const loadProjectIdx = scan.indexOf('step.run("load-project"');
  assert.ok(
    idempIdx !== -1 && loadProjectIdx !== -1 && idempIdx < loadProjectIdx,
    "the idempotency check must run before load-project/technical-audit/brand-extract, and be wrapped in step.run so Inngest's own retries of this run don't re-evaluate it against their own memoized prep step"
  );
  assert.match(scan, /duplicate:\s*true/, "a duplicate-key run must short-circuit and report itself as a duplicate");
});

// Full behavioral coverage of the cancel routes' status-transition gating,
// race handling, auth and RBAC now lives in
// src/app/api/__tests__/report-cancel-route.test.ts and scan-cancel-route.test.ts
// (real mock.module()-driven tests against the actual route handlers), so the
// source-text check that used to live here has been removed as redundant.
