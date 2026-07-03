#!/usr/bin/env node
/**
 * Poll webgraph ingest until complete, then run strict verification gates.
 * Does NOT redeploy OmniData.
 *
 * Usage:
 *   node scripts/poll-webgraph-complete.mjs
 *   node scripts/poll-webgraph-complete.mjs --interval 120 --max-hours 4
 */
import { spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

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

const args = process.argv.slice(2);
const intervalSec = Number(args.find((a, i) => args[i - 1] === "--interval") || 120);
const maxHours = Number(args.find((a, i) => args[i - 1] === "--max-hours") || 6);
const apiKey = process.env.OMNIDATA_API_KEY || "";
const base = (
  process.env.OMNIDATA_BASE_URL || "https://omnipresence-engine-production.up.railway.app"
).replace(/\/$/, "");

if (!apiKey) {
  console.error("OMNIDATA_API_KEY is required (set in .env.providers or environment)");
  process.exit(1);
}

function run(cmd, env = {}) {
  const result = spawnSync(cmd, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...env },
  });
  return result.status === 0;
}

async function status() {
  const res = await fetch(`${base}/v3/backlinks/webgraph/status`, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const json = await res.json();
  const row = json?.tasks?.[0]?.result?.[0] || {};
  return { ok: true, row };
}

console.log(`\n=== poll-webgraph-complete (${base}) ===`);
console.log(`Interval: ${intervalSec}s | Max: ${maxHours}h\n`);

const deadline = Date.now() + maxHours * 3600_000;
let lastLog = "";
let staleIngestSince = null;

while (Date.now() < deadline) {
  try {
    const s = await status();
    if (!s.ok) {
      console.log(`  status HTTP ${s.status} — retrying…`);
    } else {
      const r = s.row;
      const liveV = r.live_vertex_count ?? "—";
      const liveE = r.live_edge_count ?? "—";
      const err = r.last_ingest_error ? ` err=${r.last_ingest_error.slice(0, 80)}` : "";
      const line = `[${new Date().toISOString()}] ingest=${r.ingest_in_progress} edges_ready=${r.edges_ready} meta_v=${r.vertex_count} meta_e=${r.edge_count} live_v=${liveV} live_e=${liveE} duckdb=${r.duckdb_available}${err}`;
      if (line !== lastLog) {
        console.log(line);
        lastLog = line;
      }

      if (r.ingest_in_progress && (r.live_vertex_count ?? 0) === 0 && (r.live_edge_count ?? 0) === 0) {
        if (!staleIngestSince) staleIngestSince = Date.now();
        else if (Date.now() - staleIngestSince > 45 * 60_000) {
          console.warn("  ⚠ ingest in progress 45+ min with zero live counts — may still be downloading vertices");
        }
      } else {
        staleIngestSince = null;
      }

      if (r.last_ingest_error && !r.ingest_in_progress) {
        console.error(`\n✗ Ingest failed: ${r.last_ingest_error}\n`);
        process.exit(1);
      }

      if (r.edges_ready && r.edge_count > 0 && !r.ingest_in_progress) {
        console.log("\n✓ Ingest complete — running strict gates…\n");
        const v1 = run("npm run webgraph:verify", { WEBGRAPH_REQUIRE_FULL: "1" });
        const v2 = run("npm run ship:10-10 -- --skip-infra");
        process.exit(v1 && v2 ? 0 : 1);
      }
    }
  } catch (err) {
    console.log(`  poll error: ${err instanceof Error ? err.message : err}`);
  }
  await new Promise((r) => setTimeout(r, intervalSec * 1000));
}

console.error("\n✗ Timed out waiting for webgraph ingest\n");
process.exit(1);
