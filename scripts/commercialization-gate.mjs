#!/usr/bin/env node
/**
 * Commercialization flip gate — run before setting FREE_ACCESS_MODE=false.
 *
 * Usage:
 *   node scripts/commercialization-gate.mjs
 *   CLAIMS_STRICT=1 node scripts/commercialization-gate.mjs
 */
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(label, cmd, args, env = {}) {
  process.stdout.write(`\n>>> ${label}\n`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    shell: true,
    stdio: "inherit",
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return r.status === 0;
}

console.log("\n=== Commercialization Gate ===\n");
console.log("FREE_ACCESS_MODE stays true until this gate passes and ops flips env.\n");

const steps = [
  {
    name: "verify:all",
    ok: () => run("verify:all", "npm", ["run", "verify:all"]),
  },
  {
    name: "railway:verify",
    ok: () => run("railway:verify", "npm", ["run", "railway:verify"]),
  },
  {
    name: "webgraph:verify (WEBGRAPH_REQUIRE_FULL=0)",
    ok: () =>
      run("webgraph:verify", "npm", ["run", "webgraph:verify"], {
        WEBGRAPH_REQUIRE_FULL: "0",
      }),
  },
];

if (process.env.CLAIMS_STRICT === "1" || process.argv.includes("--claims-strict")) {
  steps.push({
    name: "claims strict (optional)",
    ok: () =>
      run("check:claims-backed strict", "npm", ["run", "check:claims-backed"], {
        CLAIMS_STRICT_PROD: "1",
      }),
  });
} else {
  console.log("○ claims strict skipped (set CLAIMS_STRICT=1 or pass --claims-strict to enforce)\n");
}

let failed = 0;
for (const step of steps) {
  process.stdout.write(`${step.name}... `);
  if (step.ok()) console.log("OK");
  else {
    console.log("FAIL");
    failed++;
  }
}

console.log(
  failed === 0
    ? "\nCommercialization gate passed. See docs/COMMERCIALIZATION_FLIP.md to flip billing.\n"
    : `\n${failed} step(s) failed — do NOT set FREE_ACCESS_MODE=false yet.\n`
);
process.exit(failed > 0 ? 1 : 0);
