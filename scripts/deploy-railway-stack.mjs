#!/usr/bin/env node
/**
 * Deploy OmniData + ai-ui-capture on Railway and wire Vercel.
 * Requires: npx @railway/cli login (browser OAuth once).
 *
 * Usage: node scripts/deploy-railway-stack.mjs [--deploy-vercel]
 */
import { spawnSync } from "child_process";
import { readFileSync, existsSync, unlinkSync } from "fs";
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

console.log("\nDeploying OmniData API…");
railwayCmd(["up", "--detach"], { cwd: omnidataDir });

console.log("\nDeploying ai-ui-capture…");
railwayCmd(["up", "--detach"], { cwd: captureDir });

console.log("\nFetching public domains (may take ~60s after first deploy)…");
const omnidataDomain = railwayCmd(["domain", "--service", "omnidata-api"], { capture: true });
const captureDomain = railwayCmd(["domain", "--service", "ai-ui-capture"], { capture: true });

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

const omnidataKey = randomBytes(32).toString("hex");
const signingSecret = randomBytes(32).toString("hex");
const captureKey = randomBytes(32).toString("hex");

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
    "omnidata-api",
    {
      OMNIDATA_API_KEY: omnidataKey,
      OMNIDATA_SIGNING_SECRET: signingSecret,
      OMNIDATA_ENABLE_WORKER: "false",
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
