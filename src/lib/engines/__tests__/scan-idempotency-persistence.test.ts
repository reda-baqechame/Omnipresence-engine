import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Deliberately a source-text check, not a behavioral one: runProjectScan()
 * is already covered behaviorally for its credit-guard early-exit path
 * (scan-credit-guard.test.ts), but driving it all the way to the
 * visibility_runs insert would require mocking ~8 more unrelated engines
 * (technical-audit, brand-extraction, prompt-generator, ...) for a check
 * that is genuinely just a field-mapping assertion, not control flow — see
 * scan-trigger-idempotency-*.test.ts for the real behavioral coverage of
 * triggerProjectScan()'s actual idempotency control flow.
 */
test("runProjectScan and prepareVisibilityScan persist idempotencyKey onto the visibility_runs row they create", () => {
  const here = dirname(fileURLToPath(import.meta.url));
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
