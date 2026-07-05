#!/usr/bin/env node
/**
 * Wire Railway OmniData + ai-ui-capture URLs into Vercel production.
 * Generates shared secrets if omitted. Redeploys Vercel when --deploy.
 *
 * Usage:
 *   node scripts/wire-railway-prod.mjs \
 *     --omnidata https://omnidata-xxx.up.railway.app \
 *     --capture https://capture-xxx.up.railway.app \
 *     [--deploy]
 *
 * Or set OMNIDATA_PUBLIC_URL + AI_CAPTURE_PUBLIC_URL in the environment.
 */
import { randomBytes } from "crypto";
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const deploy = args.includes("--deploy");
const omnidataUrl = (arg("--omnidata") || process.env.OMNIDATA_PUBLIC_URL || "").replace(/\/$/, "");
const captureUrl = (arg("--capture") || process.env.AI_CAPTURE_PUBLIC_URL || "").replace(/\/$/, "");

if (!omnidataUrl || !captureUrl) {
  console.error("\nwire-railway-prod: need --omnidata and --capture public Railway URLs\n");
  process.exit(1);
}

if (!existsSync(join(root, ".vercel", "project.json"))) {
  console.error("Run: npx vercel link\n");
  process.exit(1);
}

const omnidataKey = process.env.OMNIDATA_API_KEY || randomBytes(32).toString("hex");
const signingSecret = process.env.OMNIDATA_SIGNING_SECRET || randomBytes(32).toString("hex");
const captureKey = process.env.AI_UI_CAPTURE_KEY || randomBytes(32).toString("hex");

function readRailwaySecrets() {
  const omnidataDir = join(root, "services", "omnidata");
  const railwayBin = process.platform === "win32" ? "npx" : "railway";
  const railwayPrefix = process.platform === "win32" ? ["@railway/cli"] : [];
  const list = spawnSync(railwayBin, [...railwayPrefix, "variable", "list", "--service", "omnipresence-engine", "--json"], {
    cwd: omnidataDir,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (list.status !== 0) return {};
  try {
    return JSON.parse(list.stdout.trim());
  } catch {
    return {};
  }
}

if (!process.env.OMNIDATA_API_KEY || !process.env.OMNIDATA_SIGNING_SECRET) {
  const existing = readRailwaySecrets();
  if (existing.OMNIDATA_API_KEY && existing.OMNIDATA_SIGNING_SECRET) {
    process.env.OMNIDATA_API_KEY = existing.OMNIDATA_API_KEY;
    process.env.OMNIDATA_SIGNING_SECRET = existing.OMNIDATA_SIGNING_SECRET;
    console.log("\nUsing existing Railway OmniData secrets (no rotation).\n");
  } else {
    console.warn(
      "\n⚠ No OMNIDATA_API_KEY in env or Railway — generating new secrets (will sync to Railway + Vercel).\n"
    );
  }
}

const resolvedOmnidataKey = process.env.OMNIDATA_API_KEY || omnidataKey;
const resolvedSigningSecret = process.env.OMNIDATA_SIGNING_SECRET || signingSecret;
const resolvedCaptureKey = process.env.AI_UI_CAPTURE_KEY || captureKey;

function vercelSet(key, value, targets = ["production", "preview"]) {
  for (const env of targets) {
    spawnSync("npx", ["vercel", "env", "rm", key, env, "--yes"], {
      cwd: root,
      shell: true,
      stdio: "ignore",
    });
    const add = spawnSync("npx", ["vercel", "env", "add", key, env, "--yes", "--sensitive"], {
      cwd: root,
      input: value,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });
    if (add.status !== 0) {
      console.error(`Failed ${key} on ${env}`);
      process.exit(1);
    }
    console.log(`  ✓ Vercel ${key} → ${env}`);
  }
}

console.log("\n=== wire-railway-prod ===\n");
console.log(`OmniData: ${omnidataUrl}`);
console.log(`AI capture: ${captureUrl}\n`);

const pairs = [
  ["OMNIDATA_BASE_URL", omnidataUrl],
  ["OMNIDATA_API_KEY", resolvedOmnidataKey],
  ["OMNIDATA_SIGNING_SECRET", resolvedSigningSecret],
  ["ENABLE_AI_UI_CAPTURE", "true"],
  ["AI_UI_CAPTURE_URL", `${captureUrl}/capture`],
  ["AI_UI_CAPTURE_KEY", resolvedCaptureKey],
  ["NEXT_PUBLIC_APP_URL", "https://omnipresence-engine.vercel.app"],
  ["COMMONCRAWL_WEBGRAPH_RELEASE", process.env.COMMONCRAWL_WEBGRAPH_RELEASE || "cc-main-2024-aug-sep-oct"],
];

for (const [k, v] of pairs) vercelSet(k, v);

const omnidataDir = join(root, "services", "omnidata");
const railwayBin = process.platform === "win32" ? "npx" : "railway";
const railwayPrefix = process.platform === "win32" ? ["@railway/cli"] : [];

function railwayCmd(args, opts = {}) {
  return spawnSync(railwayBin, [...railwayPrefix, ...args], {
    cwd: opts.cwd || root,
    encoding: "utf8",
    stdio: opts.capture ? ["pipe", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
  });
}

if (!existsSync(join(root, ".railway"))) {
  railwayCmd(["link", "--project", process.env.RAILWAY_PROJECT || "omnipresence-engine"], { capture: true });
}

console.log("\nSyncing secrets to Railway services…");
for (const [service, vars] of [
  [
    "omnipresence-engine",
    {
      OMNIDATA_API_KEY: resolvedOmnidataKey,
      OMNIDATA_SIGNING_SECRET: resolvedSigningSecret,
    },
  ],
  ["ai-ui-capture", { AI_UI_CAPTURE_KEY: resolvedCaptureKey }],
]) {
  for (const [k, v] of Object.entries(vars)) {
    const set = railwayCmd(["variable", "set", `${k}=${v}`, "--service", service], { capture: true });
    if (set.status === 0) console.log(`  ✓ Railway ${service}.${k}`);
    else console.warn(`  ⚠ Failed Railway ${service}.${k}`);
  }
}

console.log("\nRailway secrets synced (same values as Vercel).\n");

if (deploy) {
  console.log("\nDeploying Vercel production…\n");
  const dep = spawnSync("npx", ["vercel", "deploy", "--prod", "--yes"], {
    cwd: root,
    shell: true,
    stdio: "inherit",
  });
  process.exit(dep.status === 0 ? 0 : 1);
}

console.log("\nRun after Railway env is set:");
console.log(`  OMNIDATA_BASE_URL=${omnidataUrl} AI_UI_CAPTURE_URL=${captureUrl} npm run railway:verify\n`);
