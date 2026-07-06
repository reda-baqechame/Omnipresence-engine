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
        "src/lib/providers/__tests__/circuit-breaker.test.ts",
        "src/lib/providers/__tests__/router-failover.smoke.test.ts",
        "src/lib/providers/__tests__/failure-injection.test.ts",
        "src/lib/inngest/__tests__/functions-reliability.test.ts",
        "src/lib/engines/__tests__/closed-loop.test.ts",
        "src/lib/engines/__tests__/measurement-evidence.test.ts",
        "src/lib/engines/__tests__/roi-provenance.test.ts",
        "src/lib/config/__tests__/claims-reality.test.ts",
        "src/lib/engines/__tests__/visibility-scanner.test.ts",
        "src/lib/engines/__tests__/keyword-intelligence.test.ts",
        "src/lib/engines/__tests__/source-influence.test.ts",
        "src/app/api/__tests__/routes-contract.test.ts",
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
