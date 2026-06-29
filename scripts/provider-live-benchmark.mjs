#!/usr/bin/env node
/**
 * Live provider benchmark runner (Phase 24.1).
 *
 * Hits the guarded /api/admin/provider-benchmark endpoint (which runs the REAL
 * sovereign engines), prints a measured sovereign-vs-paid report, and persists
 * it under docs/benchmarks/ as dated evidence.
 *
 * Requires a running app (npm run dev / a deployment). This is an on-demand
 * proof tool, NOT a CI gate, so it exits 0 with guidance if the app is
 * unreachable.
 *
 *   BENCHMARK_URL     full endpoint URL (default http://localhost:3000/api/admin/provider-benchmark)
 *   BENCHMARK_SECRET  bearer secret (or OMNIDATA_SIGNING_SECRET); omit in dev
 */
import fs from "node:fs";
import path from "node:path";

const url = process.env.BENCHMARK_URL || "http://localhost:3000/api/admin/provider-benchmark";
const secret = process.env.BENCHMARK_SECRET || process.env.OMNIDATA_SIGNING_SECRET || "";

const body = {
  urls: process.env.BENCHMARK_URLS?.split(",").map((s) => s.trim()).filter(Boolean),
  domains: process.env.BENCHMARK_DOMAINS?.split(",").map((s) => s.trim()).filter(Boolean),
  queries: process.env.BENCHMARK_QUERIES?.split(",").map((s) => s.trim()).filter(Boolean),
};

function line(metric) {
  if (!metric) return "        (paid: not configured)";
  const okp = metric.success ? "ok" : "FAIL";
  const sig = metric.signal ? " " + JSON.stringify(metric.signal) : "";
  return `        ${okp} ${metric.ms}ms via ${metric.provider || "?"} $${metric.costPerCallUsd}/call count=${metric.count ?? "-"}${sig}${metric.error ? " err=" + metric.error : ""}`;
}

function section(title, rows) {
  console.log(`\n${title}`);
  for (const r of rows) {
    console.log(`  • ${r.input}`);
    console.log(`    sovereign:\n${line(r.sovereign)}`);
    console.log(`    paid:\n${line(r.paid)}`);
    if (r.overlap !== undefined) console.log(`    overlap: ${(r.overlap * 100).toFixed(0)}%`);
    console.log(`    verdict: ${r.verdict}`);
  }
}

async function main() {
  console.log(`\n=== Live provider benchmark ===\nendpoint: ${url}\n`);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (err) {
    console.log("App not reachable. Start it first (npm run dev) or set BENCHMARK_URL to a deployment.");
    console.log(`(${err instanceof Error ? err.message : String(err)})`);
    process.exit(0);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`Benchmark endpoint returned ${res.status}: ${text}`);
    if (res.status === 401) console.error("Set BENCHMARK_SECRET (or OMNIDATA_SIGNING_SECRET) to match the server.");
    process.exit(1);
  }

  const report = await res.json();

  section("CRAWL (sovereign keyless vs Firecrawl)", report.crawl);
  section("BACKLINKS (Common Crawl webgraph vs DataForSEO)", report.backlinks);
  section("SERP (router, sovereign-first)", report.serp);
  section("GENERATE (Ollama gated vs paid LLM)", report.generate || []);

  const s = report.summary;
  console.log("\n=== Summary ===");
  console.log(`runs: ${s.total}  sovereign wins: ${s.sovereignWins}`);
  console.log(`cost — sovereign $${s.sovereignCostUsd.toFixed(4)} vs paid $${s.paidCostUsd.toFixed(4)} (saved $${s.costSavedUsd.toFixed(4)})`);
  for (const n of s.notes) console.log(`note: ${n}`);

  const dir = path.join(process.cwd(), "docs", "benchmarks");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.join(dir, `benchmark-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(report, null, 2));
  console.log(`\nEvidence written: ${path.relative(process.cwd(), out)}\n`);
  process.exit(0);
}

main();
