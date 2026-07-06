#!/usr/bin/env node
/**
 * Verify Common Crawl webgraph is fully ingested (edges_ready) on OmniData.
 *
 * Usage:
 *   node scripts/verify-webgraph.mjs [omnidataUrl]
 *   WEBGRAPH_REQUIRE_FULL=1 node scripts/verify-webgraph.mjs
 */
import { readFileSync, existsSync, unlinkSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const requireFull = process.env.WEBGRAPH_REQUIRE_FULL !== "0";
const minVolumeGb = Number(process.env.WEBGRAPH_MIN_VOLUME_GB || 20);
const testDomain = process.env.WEBGRAPH_TEST_DOMAIN || "example.com";
const pullPath = ".env.webgraph.verify.tmp";

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    encoding: "utf8",
    stdio: opts.capture ? ["pipe", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
  });
  return { ok: result.status === 0, out: (result.stdout || "") + (result.stderr || "") };
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

function loadRailwayCreds() {
  const omnidataDir = join(root, "services", "omnidata");
  const rv = run("npx", ["@railway/cli", "variables", "--json"], {
    cwd: omnidataDir,
    capture: true,
  });
  if (!rv.ok) return { base: "", key: "" };
  try {
    const parsed = JSON.parse(rv.out.trim());
    const base =
      parsed.RAILWAY_PUBLIC_DOMAIN
        ? `https://${parsed.RAILWAY_PUBLIC_DOMAIN}`
        : parsed.OMNIDATA_BASE_URL || "";
    const key = parsed.OMNIDATA_API_KEY || "";
    return { base: base.replace(/\/$/, ""), key };
  } catch {
    return { base: "", key: "" };
  }
}

function loadCreds() {
  let base =
    process.argv[2] ||
    process.env.OMNIDATA_PUBLIC_URL ||
    process.env.OMNIDATA_BASE_URL ||
    "https://omnipresence-engine-production.up.railway.app";
  let key = process.env.OMNIDATA_API_KEY || "";

  const pull = run(
    "npx",
    ["vercel", "env", "pull", pullPath, "--environment", "production", "--yes"],
    { capture: true }
  );
  if (pull.ok) {
    const env = parseEnvFile(readFileSync(join(root, pullPath), "utf8"));
    const pulledBase = env.get("OMNIDATA_BASE_URL") || "";
    const pulledKey = env.get("OMNIDATA_API_KEY") || "";
    if (pulledBase && pulledBase.trim()) base = pulledBase;
    if (pulledKey && pulledKey.trim()) key = pulledKey;
    try {
      unlinkSync(join(root, pullPath));
    } catch {
      /* ignore */
    }
  }

  // Vercel CLI pull often returns empty sensitive values — fall back to Railway.
  if (!key || !key.trim()) {
    const railway = loadRailwayCreds();
    if (railway.key) {
      key = railway.key;
      if (railway.base) base = railway.base;
      console.log("Using OmniData credentials from Railway CLI (Vercel pull empty).\n");
    }
  }

  return { base: base.replace(/\/$/, ""), key };
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, json, text };
}

function parseWebgraphStatus(body) {
  const row = body?.tasks?.[0]?.result?.[0] || body?.result?.[0] || body;
  return {
    webgraph_ready: Boolean(row?.webgraph_ready),
    edges_ready: Boolean(row?.edges_ready),
    ingest_in_progress: Boolean(row?.ingest_in_progress),
    ingest_mode: row?.ingest_mode || "unknown",
    release: row?.release ?? null,
    vertex_count: Number(row?.vertex_count ?? 0),
    edge_count: Number(row?.edge_count ?? 0),
  };
}

console.log("\n=== verify-webgraph ===\n");

const omnidataDir = join(root, "services", "omnidata");
let volumeGb = null;
const vol = run("npx", ["@railway/cli", "volume", "list", "--json"], {
  cwd: omnidataDir,
  capture: true,
});
if (vol.ok) {
  try {
    const parsed = JSON.parse(vol.out.trim());
    const engineVol = (parsed.volumes || []).find((v) => v.serviceName === "omnipresence-engine");
    if (engineVol) {
      volumeGb = Math.round((engineVol.sizeMB || 0) / 1024);
      console.log(
        `Railway volume: ${engineVol.name} — ${(engineVol.currentSizeMB / 1024).toFixed(1)}GB used / ${volumeGb}GB cap`
      );
      if (requireFull && volumeGb < minVolumeGb) {
        console.error(
          `\n✗ Volume is ${volumeGb}GB — full webgraph needs ${minVolumeGb}GB+.\n` +
            "  Railway dashboard → omnipresence-engine-volume → Live Resize → 20GB+ (Pro allows up to 50GB default).\n"
        );
        process.exit(1);
      }
    }
  } catch {
    console.warn("Could not parse railway volume list — skipping volume gate");
  }
}

const { base, key } = loadCreds();
if (!key) {
  console.error("Missing OMNIDATA_API_KEY — set env or pull from Vercel");
  process.exit(1);
}
console.log(`OmniData: ${base}\n`);

const statusRes = await fetchJson(`${base}/v3/backlinks/webgraph/status`, {
  headers: { "x-api-key": key },
});
if (!statusRes.ok || !statusRes.json) {
  console.error(`✗ webgraph/status HTTP ${statusRes.status}: ${statusRes.text?.slice(0, 200)}`);
  process.exit(1);
}

const status = parseWebgraphStatus(statusRes.json);
console.log("Webgraph status:", JSON.stringify(status, null, 2));

if (status.ingest_in_progress) {
  console.log("\n○ Ingest in progress — re-run after completion (30–90 min for full CC release)\n");
  process.exit(requireFull ? 1 : 0);
}

if (requireFull) {
  if (status.ingest_mode !== "full") {
    console.error(`\n✗ ingest_mode is "${status.ingest_mode}" — set WEBGRAPH_INGEST_MODE=full on Railway\n`);
    process.exit(1);
  }
  if (!status.edges_ready || status.edge_count <= 0 || status.vertex_count <= 0) {
    console.error("\n✗ edges_ready false or empty graph — trigger full ingest\n");
    process.exit(1);
  }
  console.log("\n✓ Full webgraph ready\n");
}

const live = await fetchJson(`${base}/v3/backlinks/summary/live`, {
  method: "POST",
  headers: { "x-api-key": key, "Content-Type": "application/json" },
  body: JSON.stringify([{ target: testDomain, limit: 5 }]),
});
if (live.ok && live.json) {
  const row = live.json?.tasks?.[0]?.result?.[0];
  const source = row?.data_source || row?.items?.[0]?.data_source;
  const refs = row?.referring_domains ?? row?.total_count;
  console.log(`Live backlink probe (${testDomain}): referring_domains=${refs ?? "null"}, data_source=${source ?? "?"}`);
  if (requireFull && source && source !== "webgraph" && source !== "common_crawl") {
    console.warn(`⚠ Expected data_source webgraph, got ${source}`);
  }
} else {
  console.warn(`⚠ Live backlink probe failed HTTP ${live.status}`);
}

console.log("\nPASS — webgraph verification complete\n");
process.exit(0);
