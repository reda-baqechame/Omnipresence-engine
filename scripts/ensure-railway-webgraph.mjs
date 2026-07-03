#!/usr/bin/env node
/**
 * Configure Railway for full Common Crawl webgraph ingest and optionally poll until ready.
 *
 * Usage:
 *   node scripts/ensure-railway-webgraph.mjs [--trigger] [--poll] [--resize-if-needed]
 */
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envProviders = join(root, ".env.providers");
if (existsSync(envProviders)) {
  for (const line of readFileSync(envProviders, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
const omnidataDir = join(root, "services", "omnidata");
const trigger = process.argv.includes("--trigger");
const poll = process.argv.includes("--poll");
const resize = process.argv.includes("--resize-if-needed");
const release = process.env.COMMONCRAWL_WEBGRAPH_RELEASE || "cc-main-2024-aug-sep-oct";
const minGb = Number(process.env.WEBGRAPH_MIN_VOLUME_GB || 20);
const omnidataUrl =
  process.env.OMNIDATA_PUBLIC_URL ||
  process.env.OMNIDATA_BASE_URL ||
  "https://omnipresence-engine-production.up.railway.app";
const apiKey = process.env.OMNIDATA_API_KEY || "";

function run(args, opts = {}) {
  const result = spawnSync("npx", ["@railway/cli", ...args], {
    cwd: opts.cwd || omnidataDir,
    encoding: "utf8",
    stdio: opts.capture ? ["pipe", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
  });
  return { ok: result.status === 0, out: (result.stdout || "") + (result.stderr || "") };
}

function getEngineVolume() {
  const vol = run(["volume", "list", "--json"], { capture: true });
  if (!vol.ok) return null;
  try {
    const parsed = JSON.parse(vol.out.trim());
    return (parsed.volumes || []).find((v) => v.serviceName === "omnipresence-engine") || null;
  } catch {
    return null;
  }
}

async function webgraphStatus() {
  if (!apiKey) return null;
  try {
    const res = await fetch(`${omnidataUrl.replace(/\/$/, "")}/v3/backlinks/webgraph/status`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.tasks?.[0]?.result?.[0] || null;
  } catch {
    return null;
  }
}

console.log("\n=== ensure-railway-webgraph ===\n");

let vol = getEngineVolume();
if (vol) {
  const capGb = Math.round(vol.sizeMB / 1024);
  console.log(`Volume: ${vol.name} — ${(vol.currentSizeMB / 1024).toFixed(1)}GB / ${capGb}GB`);
  if (resize && capGb < minGb) {
    console.log(`\nRecreating volume (Pro plan → larger default cap)…\n`);
    run(["volume", "delete", "-v", vol.name, "-y"], { capture: true });
    const add = run(["volume", "add", "--mount-path", "/data", "--json"], { capture: true });
    if (add.ok) {
      try {
        const created = JSON.parse(add.out.trim());
        console.log(`  ✓ Created volume (${Math.round((created.sizeMB || 0) / 1024)}GB cap)`);
      } catch {
        console.log("  ✓ Created volume at /data");
      }
    } else {
      console.error("  ✗ volume add failed:", add.out);
      console.error(
        `\nManual step: Railway dashboard → omnipresence-engine-volume → Live Resize → ${minGb}GB+\n`
      );
      process.exit(1);
    }
    vol = getEngineVolume();
  }
} else {
  console.log("No volume on omnipresence-engine — creating /data volume…");
  run(["volume", "add", "--mount-path", "/data", "--json"], { capture: true });
  vol = getEngineVolume();
}

const vars = {
  WEBGRAPH_INGEST_MODE: "full",
  WEBGRAPH_BUILD_EDGE_INDEX: "false",
  COMMONCRAWL_WEBGRAPH_RELEASE: release,
  WEBGRAPH_DB_PATH: "/data/webgraph-v2.duckdb",
  WEBGRAPH_WIPE_ON_START: process.env.WEBGRAPH_WIPE_ON_START === "true" ? "true" : "false",
};
for (const [k, v] of Object.entries(vars)) {
  run(["variable", "set", `${k}=${v}`, "--service", "omnipresence-engine"], { capture: true });
  console.log(`  ✓ ${k}=${v}`);
}

if (trigger) {
  if (!apiKey) {
    console.error("\nSet OMNIDATA_API_KEY to trigger ingest via API\n");
    process.exit(1);
  }
  const capGb = vol ? Math.round(vol.sizeMB / 1024) : 0;
  if (capGb < minGb && !resize) {
    console.error(
      `\n✗ Volume cap is ${capGb}GB — full webgraph needs ${minGb}GB+.\n` +
        `  Run: node scripts/railway-volume-resize.mjs ${minGb}\n` +
        `  Or pass --resize-if-needed (deletes and recreates volume — data loss).\n`
    );
    process.exit(1);
  }
  const statusBefore = await webgraphStatus();
  if (statusBefore?.ingest_in_progress) {
    console.log("\n⚠ Ingest already in progress — skipping trigger\n");
  } else {
    console.log("\nTriggering webgraph ingest via API…");
    const res = await fetch(`${omnidataUrl.replace(/\/$/, "")}/v3/backlinks/webgraph/ingest`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify([{ release }]),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    console.log(`  HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
}

const statusNow = await webgraphStatus();
const skipRedeploy = statusNow?.ingest_in_progress === true;

if (skipRedeploy) {
  console.log("\nSkipping redeploy — webgraph ingest in progress (would abort job).\n");
} else {
  console.log("\nRedeploying omnipresence-engine (applies env + auto-ingest on boot)…");
  run(["up", "--detach", "-s", "omnipresence-engine"], { cwd: omnidataDir });
}

if (poll && apiKey) {
  console.log("\nPolling webgraph status (Ctrl+C to stop)…\n");
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 60_000));
    const s = await webgraphStatus();
    if (!s) continue;
    console.log(
      `[${new Date().toISOString()}] mode=${s.ingest_mode} in_progress=${s.ingest_in_progress} edges=${s.edge_count} vertices=${s.vertex_count} ready=${s.edges_ready}`
    );
    if (s.edges_ready && Number(s.edge_count) > 0) {
      console.log("\n✓ Full webgraph ingest complete\n");
      run(["variable", "set", "WEBGRAPH_WIPE_ON_START=false", "--service", "omnipresence-engine"], {
        capture: true,
      });
      process.exit(0);
    }
    if (!s.ingest_in_progress && !s.edges_ready && i > 5) {
      console.warn("\n⚠ Ingest stopped but edges not ready — check Railway logs\n");
      process.exit(1);
    }
  }
  console.error("\n✗ Poll timeout (3h) — ingest may still be running\n");
  process.exit(1);
}

console.log("\nDone — run: npm run webgraph:verify (after ingest completes)\n");
