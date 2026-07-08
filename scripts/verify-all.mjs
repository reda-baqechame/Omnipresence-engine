#!/usr/bin/env node
/**
 * Full verification gate for OmniPresence Super Engine build loop.
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, cwd = root) {
  const r = spawnSync(cmd, args, { cwd, shell: true, stdio: "inherit", encoding: "utf8" });
  return r.status === 0;
}

const steps = [
  { name: "rls-coverage", ok: () => run("node", ["scripts/verify-rls-coverage.mjs"]) },
  { name: "migration-syntax", ok: () => run("node", ["scripts/verify-migration-syntax.mjs"]) },
  { name: "data-source-constraints", ok: () => run("node", ["scripts/verify-data-source-constraints.mjs"]) },
  { name: "zod-coverage", ok: () => run("node", ["scripts/verify-zod-coverage.mjs"]) },
  { name: "table-coverage", ok: () => run("node", ["scripts/verify-table-coverage.mjs"]) },
  { name: "column-coverage", ok: () => run("node", ["scripts/verify-column-coverage.mjs"]) },
  { name: "route-auth", ok: () => run("node", ["scripts/verify-route-auth.mjs"]) },
  { name: "claims-benchmark", ok: () => run("node", ["scripts/benchmark.mjs"]) },
  { name: "output-quality", ok: () => run("node", ["scripts/verify-output-quality.mjs"]) },
  { name: "zero-paid-keys", ok: () => run("node", ["scripts/audit-zero-paid-keys.mjs"]) },
  { name: "superiority-strict", ok: () => run("node", ["scripts/provider-superiority.mjs", "--strict"]) },
  {
    name: "quality-gate-test",
    ok: () =>
      run("node", [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        // Node <22.18 gates native `.ts` type stripping behind this flag; later
        // Node versions stabilized it and ignore/ack the flag as a no-op, so it
        // is safe to pass unconditionally across the Node versions this repo runs on.
        "--experimental-strip-types",
        // Lets behavioral route/trigger tests intercept real dependencies
        // (Supabase client, Inngest, next/server's after()) via
        // node:test's mock.module() instead of source-text/regex assertions.
        "--experimental-test-module-mocks",
        // Resolve the app's `@/` alias + extensionless imports so feature tests
        // can exercise REAL engines without production-code churn.
        "--import",
        "./tests/_lib/register-loader.mjs",
        "--test",
        "src/lib/engines/__tests__/content-defects.test.ts",
        "src/lib/engines/__tests__/revenue-connectors.test.ts",
        "src/lib/engines/__tests__/ad-connectors.test.ts",
        "src/lib/engines/__tests__/connector-health.test.ts",
        "src/lib/scoring/__tests__/presence-gate.test.ts",
        "src/lib/scoring/__tests__/omnipresence.test.ts",
        "src/lib/engines/__tests__/provenance.test.ts",
        "src/lib/engines/__tests__/share-of-voice.test.ts",
        "src/lib/engines/__tests__/aeo-metrics.test.ts",
        "src/lib/engines/__tests__/proof-report.test.ts",
        "src/lib/engines/__tests__/rank-math.test.ts",
        "src/lib/engines/__tests__/attribution.test.ts",
        "src/lib/engines/__tests__/impact-estimate.test.ts",
        "src/lib/engines/__tests__/guarantee.test.ts",
        "src/lib/engines/__tests__/structural-aeo.test.ts",
        "src/lib/engines/__tests__/citation-authority.test.ts",
        "src/lib/engines/__tests__/schema-validation.test.ts",
        "src/lib/engines/__tests__/fastest-path.test.ts",
        "src/lib/notifications/__tests__/webhooks.test.ts",
        "src/lib/security/__tests__/rate-limit.test.ts",
        "src/lib/observability/__tests__/log.test.ts",
        "src/lib/validation/__tests__/schemas.test.ts",
        "src/lib/providers/__tests__/omnidata-auth.test.ts",
        "src/lib/providers/__tests__/envelope.test.ts",
        "src/lib/providers/__tests__/keyword-cpc-cache.test.ts",
        "src/lib/providers/__tests__/circuit-breaker.test.ts",
        "src/lib/providers/__tests__/router-failover.smoke.test.ts",
        "src/lib/providers/__tests__/failure-injection.test.ts",
        "src/lib/inngest/__tests__/functions-reliability.test.ts",
        "src/lib/engines/__tests__/closed-loop.test.ts",
        "src/lib/engines/__tests__/measurement-evidence.test.ts",
        "src/lib/engines/__tests__/roi-provenance.test.ts",
        "src/lib/config/__tests__/claims-reality.test.ts",
        "src/lib/engines/__tests__/visibility-scanner.test.ts",
        "src/lib/engines/__tests__/intelligence-report-sections.test.ts",
        "src/lib/engines/__tests__/report-pdf-pipeline.test.ts",
        "src/lib/engines/__tests__/report-pdf-content-parity.test.ts",
        "src/lib/engines/__tests__/scan-cancellation.test.ts",
        "src/lib/engines/__tests__/scan-trigger-idempotency-duplicate.test.ts",
        "src/lib/engines/__tests__/scan-trigger-idempotency-sync.test.ts",
        "src/lib/engines/__tests__/scan-trigger-idempotency-inngest.test.ts",
        "src/lib/engines/__tests__/scan-idempotency-persistence.test.ts",
        "src/lib/engines/__tests__/deep-report-cancellation.test.ts",
        "src/lib/engines/__tests__/deep-report-cancellation-fanout.test.ts",
        "src/lib/engines/__tests__/report-builder-cpc-cancellation.test.ts",
        "src/lib/engines/__tests__/save-intelligence-report-cancelled-gather.test.ts",
        "src/lib/engines/__tests__/report-methodology-appendix.test.ts",
        "src/lib/engines/__tests__/intelligence-report-narrative-quality-gate.test.ts",
        "src/lib/presence-data/__tests__/index.test.ts",
        "src/lib/engines/__tests__/benchmark-writer.test.ts",
        "src/lib/engines/__tests__/benchmark-dashboard.test.ts",
        "src/lib/engines/__tests__/dataforseo-demotion-gate.test.ts",
        "src/lib/oauth/__tests__/tokens.test.ts",
        "src/lib/providers/__tests__/first-party-analytics.test.ts",
        "src/app/api/__tests__/connectors-health-route.test.ts",
        "src/app/api/__tests__/benchmark-runs-route.test.ts",
        "src/lib/scoring/__tests__/subscore-availability.test.ts",
        "src/lib/observability/__tests__/job-context.test.ts",
        "src/lib/observability/__tests__/job-progress.test.ts",
        "src/lib/engines/__tests__/scan-credit-guard.test.ts",
        "src/app/api/__tests__/report-cancel-route.test.ts",
        "src/app/api/__tests__/report-generate-cancel-download-flow.test.ts",
        "src/app/api/__tests__/jobs-running-route.test.ts",
        "src/app/api/__tests__/trust-route.test.ts",
        "src/app/api/__tests__/report-generate-versioning.test.ts",
        "src/lib/reports/__tests__/version-grouping.test.ts",
        "src/app/app/projects/__tests__/nav-reachability.test.ts",
        "src/app/api/__tests__/evidence-route.test.ts",
        "src/lib/__tests__/utils.test.ts",
        "src/app/api/__tests__/scan-cancel-route.test.ts",
        "src/app/api/__tests__/report-pdf-degraded-header.test.ts",
        "tests/security/tenant-isolation.test.ts",
        "tests/security/cross-tenant-report-cancel.test.ts",
        "tests/security/cross-tenant-scan-cancel.test.ts",
        "tests/security/cross-tenant-jobs-running.test.ts",
        "tests/security/cross-tenant-evidence.test.ts",
        "tests/security/cross-tenant-trust.test.ts",
        "tests/security/cross-tenant-report-visibility.test.ts",
        "tests/security/cross-tenant-report-pdf.test.ts",
        "src/lib/engines/__tests__/keyword-intelligence.test.ts",
        "src/lib/engines/__tests__/source-influence.test.ts",
        "src/app/api/__tests__/routes-contract.test.ts",
        "src/app/api/__tests__/routes-http.test.ts",
        "src/lib/metering/__tests__/api-usage.test.ts",
        "src/components/__tests__/trust-ui.test.ts",
      ]),
  },
  { name: "accuracy-golden", ok: () => run("node", ["scripts/verify-accuracy.mjs"]) },
  { name: "stress", ok: () => run("node", ["scripts/verify-stress.mjs"]) },
  { name: "typecheck", ok: () => run("npm", ["run", "typecheck"]) },
  { name: "lint", ok: () => run("npm", ["run", "lint"]) },
  { name: "build", ok: () => run("npm", ["run", "build"]) },
];

const omnidataPkg = join(root, "services", "omnidata", "package.json");
if (existsSync(omnidataPkg)) {
  steps.push({
    name: "omnidata-typecheck",
    ok: () => run("npm", ["run", "typecheck"], join(root, "services", "omnidata")),
  });
  steps.push({
    name: "omnidata-parity",
    ok: () => run("npm", ["run", "parity"], join(root, "services", "omnidata")),
  });
  steps.push({
    name: "omnidata-tests",
    ok: () => run("npm", ["run", "test"], join(root, "services", "omnidata")),
  });
}

const aiCapturePkg = join(root, "services", "ai-ui-capture", "package.json");
if (existsSync(aiCapturePkg)) {
  steps.push({
    name: "ai-ui-capture-typecheck",
    ok: () => run("npm", ["run", "typecheck"], join(root, "services", "ai-ui-capture")),
  });
  steps.push({
    name: "ai-ui-capture-tests",
    ok: () => run("npm", ["run", "test"], join(root, "services", "ai-ui-capture")),
  });
}

let failed = 0;
console.log("\n=== OmniPresence verify:all ===\n");
for (const step of steps) {
  process.stdout.write(`${step.name}... `);
  if (step.ok()) {
    console.log("OK");
  } else {
    console.log("FAIL");
    failed++;
  }
}

console.log(failed === 0 ? "\nAll gates passed.\n" : `\n${failed} gate(s) failed.\n`);
process.exit(failed > 0 ? 1 : 0);
