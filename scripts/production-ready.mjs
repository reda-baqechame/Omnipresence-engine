#!/usr/bin/env node
/**
 * Single production-readiness gate — local build + live audits.
 * Usage: node scripts/production-ready.mjs [baseUrl]
 *
 * Important: child processes use stdio inherit (not buffered encoding).
 * Buffering verify:all previously hit Node's default maxBuffer (~1MB) and
 * falsely failed Production Gate after the suite had already passed in CI.
 *
 * In GitHub Actions, set PRODUCTION_READY_SKIP_VERIFY_ALL=1 when the workflow
 * already ran `npm run verify:all` as a prior step (avoids a 3+ minute duplicate).
 */
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] || process.env.SMOKE_BASE_URL || "https://omnipresence-engine.vercel.app";
const skipVerifyAll =
  process.env.PRODUCTION_READY_SKIP_VERIFY_ALL === "1" ||
  process.env.PRODUCTION_READY_SKIP_VERIFY_ALL === "true";

function run(label, cmd, args, opts = {}) {
  console.log(`\n>>> ${label}\n`);
  const useShell = process.platform === "win32" && (cmd === "npm" || cmd.endsWith("npm.cmd"));
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    // Inherit — never buffer multi-MB verify:all / test output (maxBuffer false fails).
    stdio: "inherit",
    env: { ...process.env, SMOKE_BASE_URL: base, ...opts.env },
    shell: useShell,
  });
  if (result.error) {
    console.error(`  spawn error (${label}):`, result.error.message);
    return false;
  }
  return result.status === 0;
}

console.log("\n========================================");
console.log("  OmniPresence Production Ready Gate");
console.log(`  Live target: ${base}`);
if (skipVerifyAll) {
  console.log("  verify:all: skipped (PRODUCTION_READY_SKIP_VERIFY_ALL=1)");
}
console.log("========================================");

const results = [];

if (skipVerifyAll) {
  results.push(["verify:all (local CI)", true]);
  console.log("\n>>> verify:all\n\n(skipped — already executed by CI workflow)\n");
} else {
  results.push(["verify:all (local CI)", run("verify:all", "npm", ["run", "verify:all"])]);
}

results.push(
  ["e2e structure", run("e2e", "npm", ["run", "e2e:happy-path"])],
  ["omnidata tests", run("omnidata", "npm", ["run", "omnidata:test"])],
  ["audit:full (live)", run("audit:full", "npm", ["run", "audit:full"])],
  ["audit:live (measured)", run("audit:live", "npm", ["run", "audit:live"])],
  ["wire:diy (live caps)", run("wire:diy", "npm", ["run", "wire:diy"])],
  [
    "webgraph:verify",
    run("webgraph:verify", "npm", ["run", "webgraph:verify"], {
      env: {
        OMNIDATA_BASE_URL:
          process.env.OMNIDATA_BASE_URL || "https://omnipresence-engine-production.up.railway.app",
        WEBGRAPH_REQUIRE_FULL: process.env.WEBGRAPH_REQUIRE_FULL || "1",
      },
    }),
  ],
  ["email:verify (audit lead)", run("email:verify", "npm", ["run", "email:verify"])]
);

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
