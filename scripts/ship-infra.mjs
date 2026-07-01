#!/usr/bin/env node
/**
 * Infrastructure orchestrator for 10/10 ship.
 * Vercel env sync, DB migrate, optional Railway deploy.
 *
 * Usage:
 *   node scripts/ship-infra.mjs [--deploy] [--skip-railway] [--skip-migrate]
 */
import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

const REQUIRED_KEYS = [
  "ENABLE_AI_UI_CAPTURE",
  "AI_UI_CAPTURE_URL",
  "OMNIDATA_BASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "TRAFFIC_PANEL_INGEST_SECRET",
  "INTEGRATION_ENCRYPTION_KEY",
];

function run(cmd, cmdArgs, opts = {}) {
  const useShell = process.platform === "win32";
  const result = spawnSync(cmd, cmdArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    shell: useShell,
    ...opts,
  });
  return result.status === 0;
}

function runCapture(cmd, cmdArgs) {
  const useShell = process.platform === "win32";
  const result = spawnSync(cmd, cmdArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    shell: useShell,
  });
  return { ok: result.status === 0, out: (result.stdout || "") + (result.stderr || "") };
}

console.log("\n=== ship-infra ===\n");

if (!existsSync(join(root, ".vercel", "project.json"))) {
  console.log("No .vercel/project.json — run: npx vercel link\n");
  if (!run("npx", ["vercel", "link", "--yes"])) {
    console.error("Vercel link failed. Complete linking then re-run ship-infra.");
    process.exit(1);
  }
}

const providersFile = join(root, ".env.providers");
if (existsSync(providersFile)) {
  console.log("Pushing .env.providers to Vercel production…");
  if (!run("node", ["scripts/push-env-to-vercel.mjs", ".env.providers", "production"])) {
    console.warn("env:push failed — continuing if keys already on Vercel");
  }
} else {
  console.warn("No .env.providers — skipping env:push (ensure Vercel has required keys)");
}

function checkKeysFromFile() {
  if (!existsSync(providersFile)) return { missing: REQUIRED_KEYS, found: [] };
  const text = readFileSync(providersFile, "utf8");
  const found = [];
  const missing = [];
  for (const key of REQUIRED_KEYS) {
    const re = new RegExp(`^${key}=(.+)$`, "m");
    const m = text.match(re);
    if (m && m[1].trim() && !m[1].includes("your-")) found.push(key);
    else missing.push(key);
  }
  return { missing, found };
}

const { missing } = checkKeysFromFile();
if (missing.length) {
  console.warn(`Missing or placeholder keys in .env.providers: ${missing.join(", ")}`);
  console.warn("Set them before claiming 12/12 backed claims in production.");
}

if (!args.has("--skip-migrate")) {
  console.log("\nProduction DB migrate…");
  if (!run("node", ["scripts/migrate-production.mjs"])) {
    console.warn("db:migrate:prod failed — apply migrations manually if needed");
  }
}

console.log("\nEnsuring auto-fixable Vercel production env…");
run("node", ["scripts/ensure-prod-env.mjs"]);

if (!args.has("--skip-railway")) {
  const railwayCmd = process.platform === "win32" ? "npx" : "railway";
  const railwayArgs = process.platform === "win32" ? ["@railway/cli", "whoami"] : ["whoami"];
  const whoami = runCapture(railwayCmd, railwayArgs);
  if (!whoami.ok) {
    console.log("\n⚠ Railway CLI not authenticated.");
    console.log("  1. Run: npx @railway/cli login");
    console.log("  2. Open Railway in your browser to complete auth");
    console.log("  3. Re-run: npm run ship:infra\n");
    process.exit(1);
  }

  console.log("\nRailway deploy (OmniData + ai-ui-capture)…");
  const omnidataDir = join(root, "services", "omnidata");
  const captureDir = join(root, "services", "ai-ui-capture");
  const upCmd = process.platform === "win32" ? "npx" : "railway";
  const upPrefix = process.platform === "win32" ? ["@railway/cli"] : [];

  if (existsSync(omnidataDir)) {
    run(upCmd, [...upPrefix, "up", "--detach"], { cwd: omnidataDir });
  }
  if (existsSync(captureDir)) {
    run(upCmd, [...upPrefix, "up", "--detach"], { cwd: captureDir });
  }
}

if (args.has("--deploy")) {
  console.log("\nVercel production deploy…");
  run("npx", ["vercel", "deploy", "--prod", "--yes"]);
}

console.log("\nship-infra complete.\n");
