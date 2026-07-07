import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Ticket 15 (Phase 0 plan #15): idempotency for the scan-trigger path,
 * mirroring the report-generate idempotency check in
 * src/app/api/projects/[id]/report/route.ts. A double-clicked Rescan button
 * (or a retried request from a flaky client) supplying the same
 * idempotency_key must not spin up a second scan pipeline.
 *
 * triggerProjectScan() reaches for a real Supabase service-role client and
 * (on the non-duplicate path) Next's `after()`/Inngest, none of which are
 * safe to exercise in a plain node:test unit — so the "does it actually skip
 * work" contract is pinned structurally here, the same pattern already used
 * for the Inngest job invariants in functions-reliability.test.ts.
 */

const here = dirname(fileURLToPath(import.meta.url));
const triggerSrc = readFileSync(join(here, "..", "trigger-scan.ts"), "utf8");

// Scope to the exported triggerProjectScan body only — the file also defines
// scheduleInngestScanWatchdog() above it, which has its own unrelated
// after(...)/runProjectScan(...) calls that would otherwise skew offsets.
const fnStart = triggerSrc.indexOf("export async function triggerProjectScan");
const fnBody = triggerSrc.slice(fnStart);

test("triggerProjectScan checks visibility_runs for an existing idempotency_key BEFORE sending to Inngest or scheduling a background run", () => {
  assert.ok(fnStart !== -1, "triggerProjectScan must be defined");
  const idempIdx = fnBody.indexOf('.eq("idempotency_key", idempotencyKey)');
  const duplicateReturnIdx = fnBody.indexOf('return { mode: "duplicate" }');
  const inngestSendIdx = fnBody.indexOf("inngest.send(");
  const afterIdx = fnBody.indexOf("after(async () => {");

  assert.ok(idempIdx !== -1, "must query visibility_runs by idempotency_key");
  assert.ok(duplicateReturnIdx !== -1, "must short-circuit with a duplicate result");
  assert.ok(
    idempIdx < duplicateReturnIdx &&
      duplicateReturnIdx < inngestSendIdx &&
      duplicateReturnIdx < afterIdx,
    "the idempotency check and its early return must precede both the Inngest send and the background-runner scheduling"
  );
});

test("triggerProjectScan threads idempotencyKey through to both the Inngest event payload and the sync fallback", () => {
  assert.match(
    fnBody,
    /inngest\.send\(\{[\s\S]{0,120}idempotencyKey/,
    "the Inngest event data must carry idempotencyKey so run-full-scan can dedupe cross-run"
  );
  assert.match(
    fnBody,
    /runProjectScan\(supabase, projectId, \{[^}]*idempotencyKey/,
    "the sync fallback must pass idempotencyKey through to runProjectScan"
  );
});

test("runProjectScan and prepareVisibilityScan persist idempotencyKey onto the visibility_runs row they create", () => {
  const scanRunnerSrc = readFileSync(join(here, "..", "scan-runner.ts"), "utf8");
  const batchesSrc = readFileSync(join(here, "..", "visibility-scan-batches.ts"), "utf8");
  assert.match(
    scanRunnerSrc,
    /idempotency_key:\s*options\?\.idempotencyKey/,
    "runProjectScan must persist idempotencyKey onto the visibility_runs insert"
  );
  assert.match(
    batchesSrc,
    /idempotency_key:\s*options\?\.idempotencyKey/,
    "prepareVisibilityScan must persist idempotencyKey onto the visibility_runs insert"
  );
});
