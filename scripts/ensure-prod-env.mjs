#!/usr/bin/env node
/**
 * Ensure production-critical Vercel env vars exist with valid values.
 * Auto-fixes keys we can generate; reports keys that need Railway / OAuth.
 *
 * Usage: node scripts/ensure-prod-env.mjs [--deploy]
 */
import { randomBytes } from "crypto";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deploy = process.argv.includes("--deploy");
const DEFAULT_APP_URL = "https://omnipresence-engine.vercel.app";
const pullPath = ".env.ensure.tmp";

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: opts.capture ? ["pipe", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  return {
    ok: result.status === 0,
    out: (result.stdout || "") + (result.stderr || ""),
  };
}

function parseEnvFile(text) {
  const map = new Map();
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    map.set(key, v);
  }
  return map;
}

function vercelAdd(key, value, targets = ["production", "preview"]) {
  for (const env of targets) {
    run("npx", ["vercel", "env", "rm", key, env, "--yes"], { capture: true });
    const add = run(
      "npx",
      ["vercel", "env", "add", key, env, "--value", value, "--yes", "--sensitive"],
      { capture: true }
    );
    if (!add.ok) {
      console.error(`Failed to set ${key} on ${env}:`, add.out);
      return false;
    }
    console.log(`  ✓ ${key} → ${env}`);
  }
  return true;
}

console.log("\n=== ensure-prod-env ===\n");

if (!existsSync(join(root, ".vercel", "project.json"))) {
  console.error("No .vercel/project.json — run: npx vercel link\n");
  process.exit(1);
}

const pull = run(
  "npx",
  ["vercel", "env", "pull", pullPath, "--environment", "production", "--yes"],
  { capture: true }
);
if (!pull.ok) {
  console.error("Could not pull Vercel production env:", pull.out);
  process.exit(1);
}

const env = parseEnvFile(readFileSync(join(root, pullPath), "utf8"));
try {
  unlinkSync(join(root, pullPath));
} catch {
  /* ignore */
}

const fixes = [];

function needs(key) {
  const v = env.get(key);
  return !v || !v.trim() || v.startsWith("your-") || v === '""';
}

if (needs("NEXT_PUBLIC_APP_URL")) {
  fixes.push(["NEXT_PUBLIC_APP_URL", DEFAULT_APP_URL]);
}
if (needs("OAUTH_STATE_SECRET")) {
  fixes.push(["OAUTH_STATE_SECRET", randomBytes(32).toString("hex")]);
}
if (needs("TRAFFIC_PANEL_INGEST_SECRET")) {
  fixes.push(["TRAFFIC_PANEL_INGEST_SECRET", randomBytes(24).toString("base64url")]);
}
if (needs("INTEGRATION_ENCRYPTION_KEY")) {
  fixes.push(["INTEGRATION_ENCRYPTION_KEY", randomBytes(32).toString("base64url")]);
}

if (fixes.length) {
  console.log("Applying auto-fixes on Vercel:\n");
  for (const [key, value] of fixes) {
    vercelAdd(key, value);
  }
  console.log("\nRedeploy required for public env vars to take effect.\n");
} else {
  console.log("✓ Auto-fixable production keys already set.\n");
}

const manual = [
  "OMNIDATA_BASE_URL",
  "OMNIDATA_API_KEY",
  "OMNIDATA_SIGNING_SECRET",
  "ENABLE_AI_UI_CAPTURE",
  "AI_UI_CAPTURE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
];

async function probeLiveHealth(url) {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/health`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const health = await probeLiveHealth(DEFAULT_APP_URL);
const omnidataLive =
  health?.checks?.omnidata === "ok" ||
  health?.production?.checks?.some?.((c) => c.id === "omnidata" && c.ok);

const missingManual = manual.filter((key) => {
  if (needs(key)) {
    if (omnidataLive && key.startsWith("OMNIDATA_")) return false;
    if (
      omnidataLive &&
      (key === "ENABLE_AI_UI_CAPTURE" || key === "AI_UI_CAPTURE_URL") &&
      health?.checks?.aiUiCapture === "ok"
    ) {
      return false;
    }
    return true;
  }
  return false;
});
if (missingManual.length) {
  console.log("Still need (Railway / OAuth — add to .env.providers then npm run env:push):");
  for (const k of missingManual) console.log(`  ○ ${k}`);
  console.log("");
}

if (deploy || fixes.length) {
  console.log("Triggering production deploy…\n");
  const dep = run("npx", ["vercel", "deploy", "--prod", "--yes"]);
  if (!dep.ok) process.exit(1);
}

process.exit(missingManual.length && process.argv.includes("--strict") ? 1 : 0);
