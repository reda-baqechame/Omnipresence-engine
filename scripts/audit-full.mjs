#!/usr/bin/env node
/**
 * Full production audit — runs all phase audits + verify:prod.
 * Usage: node scripts/audit-full.mjs [baseUrl]
 */
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] || process.env.SMOKE_BASE_URL || "https://omnipresence-engine.vercel.app";

function run(label, script, extraArgs = []) {
  console.log(`\n>>> ${label}\n`);
  const result = spawnSync(process.execPath, [join(root, script), ...extraArgs], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, SMOKE_BASE_URL: base },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (script.includes("verify-production") && result.stdout?.includes("Prod ready:  YES")) {
    return true;
  }
  return result.status === 0;
}

console.log("\n========================================");
console.log("  OmniPresence Full Production Audit");
console.log(`  Target: ${base}`);
console.log("========================================");

const results = [
  ["Phase 8 audit", run("Phase 8", "scripts/audit-phase8.mjs", [base])],
  ["Phase 9 audit", run("Phase 9", "scripts/audit-phase9.mjs", [base])],
  ["verify:prod", run("verify:prod", "scripts/verify-production.mjs", [base])],
];

console.log("\n========================================");
console.log("  Summary");
console.log("========================================\n");

let allPass = true;
for (const [name, ok] of results) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) allPass = false;
}

console.log(`\n${allPass ? "FULL AUDIT PASSED" : "FULL AUDIT FAILED"}\n`);
process.exit(allPass ? 0 : 1);
