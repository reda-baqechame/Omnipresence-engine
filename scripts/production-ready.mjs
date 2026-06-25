#!/usr/bin/env node
/**
 * Single production-readiness gate — local build + live audits.
 * Usage: node scripts/production-ready.mjs [baseUrl]
 */
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] || process.env.SMOKE_BASE_URL || "https://omnipresence-engine.vercel.app";

function run(label, cmd, args, cwd = root) {
  console.log(`\n>>> ${label}\n`);
  const useShell = process.platform === "win32" && (cmd === "npm" || cmd.endsWith("npm.cmd"));
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, SMOKE_BASE_URL: base },
    shell: useShell,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (
    result.stdout?.includes("FULL AUDIT PASSED") ||
    result.stdout?.includes("Prod ready:  YES") ||
    result.stdout?.includes("Production ready: YES") ||
    (label === "audit:live" && result.stdout?.includes("PASS — 0 issue"))
  ) {
    return true;
  }
  if (result.stdout?.includes("FULL AUDIT FAILED") || result.stdout?.includes("NOT READY")) {
    return false;
  }
  return result.status === 0;
}

console.log("\n========================================");
console.log("  OmniPresence Production Ready Gate");
console.log(`  Live target: ${base}`);
console.log("========================================");

const results = [
  ["verify:all (local CI)", run("verify:all", "npm", ["run", "verify:all"])],
  ["e2e structure", run("e2e", "npm", ["run", "e2e:happy-path"])],
  ["omnidata tests", run("omnidata", "npm", ["run", "omnidata:test"])],
  ["audit:full (live)", run("audit:full", "npm", ["run", "audit:full"])],
  ["audit:live (measured)", run("audit:live", "npm", ["run", "audit:live"])],
  ["wire:diy (live caps)", run("wire:diy", "npm", ["run", "wire:diy"])],
];

console.log("\n========================================");
console.log("  Summary");
console.log("========================================\n");

let allPass = true;
for (const [name, ok] of results) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) allPass = false;
}

console.log(`\n${allPass ? "PRODUCTION READY — all gates passed" : "NOT READY — fix failures above"}\n`);
process.exit(allPass ? 0 : 1);
