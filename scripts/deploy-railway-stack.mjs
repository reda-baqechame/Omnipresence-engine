#!/usr/bin/env node
/**
 * Deploy OmniData + ai-ui-capture on Railway and wire Vercel.
 * Requires: npx @railway/cli login (browser OAuth once).
 *
 * Usage: node scripts/deploy-railway-stack.mjs [--deploy-vercel]
 */
import { spawnSync } from "child_process";
import { readFileSync, existsSync, unlinkSync, copyFileSync, renameSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deployVercel = process.argv.includes("--deploy-vercel");
const railwayBin = process.platform === "win32" ? "npx" : "railway";
const railwayPrefix = process.platform === "win32" ? ["@railway/cli"] : [];

function run(cmd, args, opts = {}) {
  const useShell = process.platform === "win32";
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    encoding: "utf8",
    stdio: opts.capture ? ["pipe", "pipe", "pipe"] : "inherit",
    shell: useShell,
  });
  return { ok: result.status === 0, out: (result.stdout || "") + (result.stderr || "") };
}

function railwayCmd(args, opts = {}) {
  return run(railwayBin, [...railwayPrefix, ...args], opts);
}

console.log("\n=== deploy-railway-stack ===\n");

const who = railwayCmd(["whoami"], { capture: true });
if (!who.ok) {
  console.log("Run: npx @railway/cli login   (complete OAuth in browser)\n");
  process.exit(1);
}
console.log(who.out.trim());

// Ensure linked
if (!existsSync(join(root, ".railway"))) {
  console.log("\nLink Railway project (select or create Omnipresence stack)…\n");
  const link = railwayCmd(["link"]);
  if (!link.ok) process.exit(1);
}

const omnidataDir = join(root, "services", "omnidata");
const captureDir = join(root, "services", "ai-ui-capture");
const forceOmnidata = process.argv.includes("--force-omnidata");
const preserveSecrets = process.argv.includes("--preserve-secrets");

function resolveWebgraphIngestMode(volumeSizeMb) {
  const explicit = process.env.WEBGRAPH_INGEST_MODE || process.env.RAILWAY_WEBGRAPH_MODE;
  if (explicit) return explicit;
  if (process.env.RAILWAY_WEBGRAPH_FULL === "true") return "full";
  const capGb = volumeSizeMb ? volumeSizeMb / 1024 : 0;
  return capGb >= 20 ? "full" : "ranks-only";
}

function readExistingRailwaySecrets() {
  const existing = railwayCmd(["variable", "list", "--service", "omnipresence-engine", "--json"], {
    cwd: omnidataDir,
    capture: true,
  });
  if (!existing.ok) return {};
  try {
    return JSON.parse(existing.out.trim());
  } catch {
    return {};
  }
}

async function isWebgraphIngestRunning(baseUrl, apiKey) {
  if (!baseUrl || !apiKey) return false;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v3/backlinks/webgraph/status`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return false;
    const body = await res.json();
    const row = body?.tasks?.[0]?.result?.[0];
    return Boolean(row?.ingest_in_progress);
  } catch {
    return false;
  }
}

const omnidataPublic =
  process.env.OMNIDATA_PUBLIC_URL ||
  process.env.OMNIDATA_BASE_URL ||
  "https://omnipresence-engine-production.up.railway.app";
const omnidataApiKey = process.env.OMNIDATA_API_KEY || "";
const ingestRunning = await isWebgraphIngestRunning(omnidataPublic, omnidataApiKey);

if (ingestRunning && !forceOmnidata) {
  console.log("\n⚠ Webgraph ingest in progress — skipping OmniData API redeploy (would abort ingest).");
  console.log("  Redeploy after ingest: node scripts/deploy-railway-stack.mjs --force-omnidata\n");
} else {
  console.log("\nDeploying OmniData API…");
  railwayCmd(["up", "--detach"], { cwd: omnidataDir });
}

console.log("\nDeploying ai-ui-capture…");
railwayCmd(["up", "--detach"], { cwd: captureDir });

// --- Volume + worker (Railway hardening) ---
console.log("\nEnsuring /data volume on omnipresence-engine…");
railwayCmd(["service", "link", "omnipresence-engine"], { cwd: omnidataDir, capture: true });
const volList = railwayCmd(["volume", "list", "--json"], { cwd: omnidataDir, capture: true });
if (!volList.out.includes("omnipresence-engine") && !volList.out.includes('"serviceName":"omnipresence-engine"')) {
  const volAdd = railwayCmd(["volume", "add", "--mount-path", "/data", "--json"], {
    cwd: omnidataDir,
    capture: true,
  });
  if (volAdd.ok) console.log("  ✓ Created omnipresence-engine-volume at /data");
  else console.warn("  ⚠ Volume add failed — attach /data in Railway UI if missing");
} else {
  console.log("  ✓ Volume already attached to omnipresence-engine");
}
console.log(
  "  ℹ Common Crawl domain webgraph needs 20GB+ volume (Live Resize in Railway UI on Pro). Hobby caps at 5GB."
);

let engineVolumeSizeMb = 5000;
try {
  const volJson = JSON.parse(volList.out.trim());
  const engineVol = (volJson.volumes || []).find((v) => v.serviceName === "omnipresence-engine" && !v.isPendingDeletion);
  if (engineVol?.sizeMB) engineVolumeSizeMb = engineVol.sizeMB;
} catch {
  /* ignore */
}
const webgraphMode = resolveWebgraphIngestMode(engineVolumeSizeMb);
console.log(`  ℹ WEBGRAPH_INGEST_MODE → ${webgraphMode} (volume cap ~${Math.round(engineVolumeSizeMb / 1024)}GB)`);

console.log("\nEnsuring omnidata-worker service…");
const svcList = railwayCmd(["service", "list", "--json"], { cwd: omnidataDir, capture: true });
const hasWorker = svcList.out.includes("omnidata-worker");
if (!hasWorker) {
  railwayCmd(["add", "--service", "omnidata-worker", "--json"], { cwd: omnidataDir, capture: true });
  console.log("  ✓ Created omnidata-worker");
}

function deployWorker(omnidataKey, signingSecret, redisUrl) {
  const workerVars = {
    REDIS_URL: redisUrl || "${{Redis.REDIS_URL}}",
    OMNIDATA_API_KEY: omnidataKey,
    OMNIDATA_SIGNING_SECRET: signingSecret,
    WEBGRAPH_DB_PATH: "/data/webgraph.duckdb",
  };
  for (const [k, v] of Object.entries(workerVars)) {
    railwayCmd(["variable", "set", `${k}=${v}`, "--service", "omnidata-worker"], {
      cwd: omnidataDir,
      capture: true,
    });
  }
  // Railway allows one volume per service; webgraph ingest runs on the API
  // service where /data is mounted. Worker handles BullMQ queue jobs only.
  const apiCfg = join(omnidataDir, "railway.json");
  const workerCfg = join(omnidataDir, "railway.worker.json");
  const bakCfg = join(omnidataDir, "railway.api.json.bak");
  copyFileSync(apiCfg, bakCfg);
  copyFileSync(workerCfg, apiCfg);
  railwayCmd(["up", "--detach", "-s", "omnidata-worker"], { cwd: omnidataDir });
  renameSync(bakCfg, apiCfg);
  console.log("  ✓ Deployed omnidata-worker (node dist/worker.js)");
}

console.log("\nFetching public domains (may take ~60s after first deploy)…");
const omnidataDomain = railwayCmd(["domain", "list", "--service", "omnipresence-engine", "--json"], { capture: true });
const captureDomain = railwayCmd(["domain", "list", "--service", "ai-ui-capture", "--json"], { capture: true });

function parseDomain(out) {
  const m = out.match(/https?:\/\/[^\s]+/);
  return m ? m[0].replace(/\/$/, "") : "";
}

let omnidataUrl = parseDomain(omnidataDomain.out);
let captureUrl = parseDomain(captureDomain.out);

if (!omnidataUrl) {
  omnidataUrl = process.env.OMNIDATA_PUBLIC_URL || "";
  console.warn("Could not auto-detect OmniData URL — set OMNIDATA_PUBLIC_URL or assign domain in Railway UI.");
}
if (!captureUrl) {
  captureUrl = process.env.AI_CAPTURE_PUBLIC_URL || "";
  console.warn("Could not auto-detect capture URL — set AI_CAPTURE_PUBLIC_URL or assign domain in Railway UI.");
}

if (!omnidataUrl || !captureUrl) {
  console.log("\nAfter assigning *.up.railway.app domains, run:");
  console.log("  node scripts/wire-railway-prod.mjs --omnidata <url> --capture <url> --deploy\n");
  process.exit(1);
}

const existingRailway = preserveSecrets ? readExistingRailwaySecrets() : {};

const omnidataKey =
  preserveSecrets && existingRailway.OMNIDATA_API_KEY
    ? existingRailway.OMNIDATA_API_KEY
    : randomBytes(32).toString("hex");
const signingSecret =
  preserveSecrets && existingRailway.OMNIDATA_SIGNING_SECRET
    ? existingRailway.OMNIDATA_SIGNING_SECRET
    : randomBytes(32).toString("hex");
const captureKey =
  preserveSecrets && existingRailway.AI_UI_CAPTURE_KEY
    ? existingRailway.AI_UI_CAPTURE_KEY
    : randomBytes(32).toString("hex");

// Copy paid SERP keys from Vercel production into OmniData (real measured SERP on sovereign stack).
const pullPath = join(root, ".env.railway.sync");
const pull = run("npx", ["vercel", "env", "pull", pullPath, "--environment", "production", "--yes"], {
  capture: true,
});
const serpKeys = ["SERPER_API_KEY", "FIRECRAWL_API_KEY", "BRAVE_SEARCH_API_KEY", "COMMONCRAWL_WEBGRAPH_RELEASE"];
const serpVars = {};
if (pull.ok && existsSync(join(root, pullPath))) {
  for (const line of readFileSync(join(root, pullPath), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || !serpKeys.includes(m[1])) continue;
    const v = m[2].replace(/^"|"$/g, "").trim();
    if (v) serpVars[m[1]] = v;
  }
  try {
    unlinkSync(join(root, pullPath));
  } catch {
    /* ignore */
  }
}

console.log(`\nOmniData URL: ${omnidataUrl}`);
console.log(`Capture URL: ${captureUrl}\n`);

// Push secrets to Railway services
for (const [service, vars] of [
  [
    "omnipresence-engine",
    {
      OMNIDATA_API_KEY: omnidataKey,
      OMNIDATA_SIGNING_SECRET: signingSecret,
      OMNIDATA_ENABLE_WORKER: "false",
      WEBGRAPH_INGEST_MODE: webgraphMode,
      WEBGRAPH_DB_PATH: "/data/webgraph.duckdb",
      COMMONCRAWL_WEBGRAPH_RELEASE:
        serpVars.COMMONCRAWL_WEBGRAPH_RELEASE || "cc-main-2024-aug-sep-oct",
      ...serpVars,
    },
  ],
  ["ai-ui-capture", { AI_UI_CAPTURE_KEY: captureKey }],
]) {
  for (const [k, v] of Object.entries(vars)) {
    railwayCmd(["variable", "set", `${k}=${v}`, "--service", service], { capture: true });
    console.log(`  ✓ Railway ${service}.${k}`);
  }
}

const redisVar = railwayCmd(["variable", "list", "--service", "omnipresence-engine", "--json"], {
  cwd: omnidataDir,
  capture: true,
});
let redisUrl = "";
try {
  const parsed = JSON.parse(redisVar.out.trim());
  redisUrl = parsed.REDIS_URL || "";
} catch {
  /* use template fallback */
}
deployWorker(omnidataKey, signingSecret, redisUrl);

const wireArgs = [
  "scripts/wire-railway-prod.mjs",
  "--omnidata",
  omnidataUrl,
  "--capture",
  captureUrl,
];
if (deployVercel) wireArgs.push("--deploy");
process.env.OMNIDATA_API_KEY = omnidataKey;
process.env.OMNIDATA_SIGNING_SECRET = signingSecret;
process.env.AI_UI_CAPTURE_KEY = captureKey;

const wire = run("node", wireArgs);
process.exit(wire.ok ? 0 : 1);
