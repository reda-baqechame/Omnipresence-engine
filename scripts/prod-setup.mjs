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
console.log("  1. npm run db:migrate:prod     # through 0017_phase9.sql");
console.log("  2. Set OMNIDATA_BASE_URL on Vercel (optional but recommended)");
console.log("  3. npm run production:ready    # full audit against live URL");
console.log("");

if (deploy) {
  console.log("Triggering production deploy…\n");
  const dep = run("vercel", ["deploy", "--prod", "--yes"]);
  console.log(dep.out || dep.err);
  process.exit(dep.ok ? 0 : 1);
}

const full1010 = process.argv.includes("--full-10-10");
if (full1010) {
  console.log("\n=== Full 10/10 env checklist (Vercel production) ===\n");
  const required = [
    "ENABLE_AI_UI_CAPTURE",
    "AI_UI_CAPTURE_URL",
    "OMNIDATA_BASE_URL",
    "OMNIDATA_API_KEY",
    "NEXT_PUBLIC_APP_URL",
    "TRAFFIC_PANEL_INGEST_SECRET",
    "INTEGRATION_ENCRYPTION_KEY",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
  ];
  const missing = required.filter((k) => !ls.out.includes(k));
  for (const k of required) {
    console.log(`  ${ls.out.includes(k) ? "✓" : "✗"} ${k}`);
  }
  if (missing.length) {
    console.log("\nSet missing keys via: npm run env:push (from .env.providers)\n");
    process.exit(1);
  }
  console.log("\nAll 10/10 keys present on Vercel. Run: npm run check:claims-backed\n");
}
