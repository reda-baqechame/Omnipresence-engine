#!/usr/bin/env node
/**
 * Production bootstrap: ensure INTEGRATION_ENCRYPTION_KEY on Vercel, print next steps.
 * Usage: node scripts/prod-setup.mjs [--deploy]
 */

import { randomBytes } from "crypto";
import { spawnSync } from "child_process";

const deploy = process.argv.includes("--deploy");

function run(cmd, args, input) {
  const result = spawnSync(cmd, args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  return { ok: result.status === 0, out: result.stdout, err: result.stderr };
}

console.log("\n=== OmniPresence Production Setup ===\n");

const ls = run("vercel", ["env", "ls"]);
if (!ls.ok) {
  console.log("Vercel CLI not linked. Run: vercel link\n");
  process.exit(1);
}

const hasKey = ls.out.includes("INTEGRATION_ENCRYPTION_KEY");
if (!hasKey) {
  const key = randomBytes(32).toString("base64url");
  console.log("Adding INTEGRATION_ENCRYPTION_KEY to Vercel (production + preview)…");
  for (const env of ["production", "preview"]) {
    const add = run("vercel", [
      "env",
      "add",
      "INTEGRATION_ENCRYPTION_KEY",
      env,
      "--value",
      key,
      "--yes",
      "--sensitive",
    ]);
    if (!add.ok) {
      console.error(`Failed for ${env}:`, add.err || add.out);
      process.exit(1);
    }
    console.log(`  ✓ ${env}`);
  }
  console.log("\nEncryption key set (value not logged). Redeploy required.\n");
} else {
  console.log("✓ INTEGRATION_ENCRYPTION_KEY already on Vercel\n");
}

console.log("Next steps:");
console.log("  1. npm run db:migrate          # through 0015_intelligence.sql");
console.log("  2. Set OMNIDATA_BASE_URL on Vercel (optional but recommended)");
console.log("  3. npm run verify:prod         # against live URL");
console.log("");

if (deploy) {
  console.log("Triggering production deploy…\n");
  const dep = run("vercel", ["deploy", "--prod", "--yes"]);
  console.log(dep.out || dep.err);
  process.exit(dep.ok ? 0 : 1);
}
