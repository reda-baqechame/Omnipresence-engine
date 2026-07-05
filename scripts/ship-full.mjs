#!/usr/bin/env node
/**
 * Master full-ship orchestrator — all gates before GitHub/Railway/Vercel deploy.
 *
 * Usage:
 *   node scripts/ship-full.mjs
 *   node scripts/ship-full.mjs --push
 *   node scripts/ship-full.mjs --skip-oauth --skip-scan
 */
import { spawnSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const projectId = process.env.PROJECT_ID || "b1055406-874d-4f5b-975a-9be1bf6aabbf";
const base = (process.env.SMOKE_BASE_URL || "https://omnipresence-engine.vercel.app").replace(/\/$/, "");

const reportDir = join(root, "reports");
mkdirSync(reportDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const reportPath = join(reportDir, `ship-full-${stamp}.json`);

const results = [];

function run(label, cmd, cmdArgs, env = {}) {
  console.log(`\n>>> ${label}\n`);
  const r = spawnSync(cmd, cmdArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...env },
  });
  const ok = r.status === 0;
  results.push([label, ok]);
  return ok;
}

function failAndExit(label) {
  console.error(`\nship-full: FAILED at ${label}\n`);
  writeFileSync(reportPath, JSON.stringify({ at: new Date().toISOString(), gate: "NOT_READY", steps: Object.fromEntries(results) }, null, 2));
  process.exit(1);
}

console.log("\n=== ship-full ===");
console.log(`  project: ${projectId}`);
console.log(`  base: ${base}\n`);

if (!run("verify:all", "npm", ["run", "verify:all"])) failAndExit("verify:all");

if (!args.has("--skip-oauth")) {
  const oauthArgs = ["scripts/oauth-bootstrap.mjs", "--project", projectId, "--base", base];
  if (process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    /* token inject path inside bootstrap */
  }
  if (!run("oauth-bootstrap", "node", oauthArgs)) failAndExit("oauth-bootstrap");
}

const hubArgs = ["scripts/hub-e2e-audit.mjs", "--project", projectId, "--base", base, "--strict"];
if (!args.has("--skip-oauth")) hubArgs.push("--require-oauth");
else hubArgs.push("--skip-oauth");
if (args.has("--skip-scan")) hubArgs.push("--skip-scan");
if (!run("audit:hubs", "node", hubArgs, { SMOKE_BASE_URL: base })) failAndExit("audit:hubs");

if (!run("test:panels", "npm", ["run", "test:panels", base], { SMOKE_BASE_URL: base })) failAndExit("test:panels");

if (!run("test:professional", "npm", ["run", "test:professional"])) failAndExit("test:professional");

const shipArgs = ["scripts/ship-10-10.mjs"];
if (args.has("--push")) shipArgs.push("--deploy");
else shipArgs.push("--skip-infra", "--skip-live");
if (!run("ship:10-10", "node", shipArgs)) failAndExit("ship:10-10");

if (args.has("--push")) {
  if (!run("git-push", "git", ["push", "origin", "main"])) failAndExit("git-push");
  if (!run("railway-deploy", "npm", ["run", "railway:deploy"])) failAndExit("railway-deploy");
  if (!run("prod-env", "node", ["scripts/ensure-prod-env.mjs", "--deploy"])) failAndExit("prod-env");
  if (!run("railway-wire", "npm", ["run", "railway:wire"])) failAndExit("railway-wire");
  if (!run("verify-prod-post", "npm", ["run", "verify:prod", base], { SMOKE_BASE_URL: base })) failAndExit("verify-prod-post");
}

const summary = {
  at: new Date().toISOString(),
  gate: results.every(([, ok]) => ok) ? "SHIP_FULL_OK" : "NOT_READY",
  projectId,
  base,
  steps: Object.fromEntries(results),
};

writeFileSync(reportPath, JSON.stringify(summary, null, 2));

console.log("\n========================================");
console.log("  ship-full Summary");
console.log("========================================\n");
for (const [name, ok] of results) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
}
console.log(`\nReport: ${reportPath}`);
console.log(summary.gate === "SHIP_FULL_OK" ? "\nSHIP FULL — all gates passed\n" : "\nNOT READY\n");

process.exit(summary.gate === "SHIP_FULL_OK" ? 0 : 1);
