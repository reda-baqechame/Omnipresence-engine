import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * MANUAL_ONLY_MODE must register only user-initiated Inngest handlers and
 * never cron schedules or auto follow-ups (deployRescanLoop).
 */

const here = dirname(fileURLToPath(import.meta.url));
const functionsSource = readFileSync(join(here, "..", "functions.ts"), "utf8");
const opsSource = readFileSync(
  join(here, "..", "..", "engines", "ops-executor.ts"),
  "utf8"
);

const MANUAL_EVENT_IDS = [
  "run-full-scan",
  "run-full-scan-legacy",
  "generate-report",
  "sync-attribution",
  "geo-rewrite-loop",
  "ops-execute-requested",
  "panel-run-requested",
] as const;

const CRON_OR_AUTO_IDS = [
  "monthly-rescan",
  "weekly-rescan",
  "nightly-provider-benchmark",
  "daily-rank-check",
  "ops-queue-drain",
  "deploy-rescan-loop",
  "scheduled-content-publish",
  "weekly-panel-run",
] as const;

describe("manual-only Inngest registry", () => {
  test("manualEventFunctions export has exactly 7 handlers (source + length contract)", async () => {
    const mod = await import("../functions.ts");
    assert.equal(mod.manualEventFunctions.length, MANUAL_EVENT_IDS.length);
  });

  test("manualEventFunctions export lists only event-triggered jobs (source contract)", () => {
    assert.match(functionsSource, /export const manualEventFunctions\s*=\s*\[/);
    const block = functionsSource.match(
      /export const manualEventFunctions\s*=\s*\[([\s\S]*?)\];/
    )?.[1];
    assert.ok(block, "manualEventFunctions array must exist");
    for (const name of [
      "runFullScan",
      "runFullScanLegacy",
      "generateReport",
      "syncAttribution",
      "geoRewriteLoop",
      "runOpsItem",
      "runPanelOnRequest",
    ]) {
      assert.match(block!, new RegExp(`\\b${name}\\b`), `manual list must include ${name}`);
    }
    for (const name of [
      "weeklyRescan",
      "monthlyRescan",
      "nightlyProviderBenchmark",
      "opsQueueDrain",
      "deployRescanLoop",
      "scheduledContentPublish",
    ]) {
      assert.doesNotMatch(
        block!,
        new RegExp(`\\b${name}\\b`),
        `manual list must NOT include ${name}`
      );
    }
  });

  test("getInngestFunctions respects MANUAL_ONLY_MODE (source contract)", () => {
    assert.match(functionsSource, /export function getInngestFunctions/);
    assert.match(functionsSource, /if\s*\(\s*MANUAL_ONLY_MODE\s*\)\s*return\s*manualEventFunctions/);
  });

  test("inngest route uses getInngestFunctions()", () => {
    const route = readFileSync(
      join(here, "..", "..", "..", "app", "api", "inngest", "route.ts"),
      "utf8"
    );
    assert.match(route, /getInngestFunctions\(\)/);
    assert.doesNotMatch(route, /functions:\s*functions\b/);
  });

  test("cron/auto ids still exist in the full registry for rollback", () => {
    for (const id of CRON_OR_AUTO_IDS) {
      assert.match(
        functionsSource,
        new RegExp(`id:\\s*"${id}"`),
        `full registry must still define ${id} for MANUAL_ONLY_MODE=false`
      );
    }
  });
});

test("ops-executor skips asset/deployed when MANUAL_ONLY_MODE is on", () => {
  assert.match(opsSource, /MANUAL_ONLY_MODE/);
  assert.match(opsSource, /if\s*\(\s*!MANUAL_ONLY_MODE\s*\)/);
  assert.match(opsSource, /asset\/deployed/);
});

test("background-jobs config exports MANUAL_ONLY_MODE", () => {
  const cfg = readFileSync(
    join(here, "..", "..", "config", "background-jobs.ts"),
    "utf8"
  );
  assert.match(cfg, /export const MANUAL_ONLY_MODE/);
  assert.match(cfg, /MANUAL_ONLY_MODE\s*===\s*"true"/);
});
