#!/usr/bin/env node
/**
 * Staging benchmark / RLS proof readiness check (Shot 2).
 *
 * Configuration-only — never creates fake benchmark rows.
 * Never calls paid providers unless RUN_LIVE_BENCHMARK_CHECK=1.
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const combinedPath = join(root, "supabase/migrations/combined.sql");

const REQUIRED_ENV = [
  { key: "BENCHMARK_URLS", purpose: "crawl benchmark URLs" },
  { key: "BENCHMARK_DOMAINS", purpose: "backlink benchmark domains" },
  { key: "BENCHMARK_QUERIES", purpose: "SERP benchmark queries" },
  { key: "OMNIDATA_BASE_URL", purpose: "sovereign data service" },
  { key: "OMNIDATA_API_KEY", purpose: "OmniData auth" },
  { key: "OMNIDATA_SIGNING_SECRET", purpose: "request signing" },
  { key: "BENCHMARK_SECRET", purpose: "admin benchmark route bearer" },
];

const OPTIONAL_ENV = [
  { key: "DATAFORSEO_LOGIN", purpose: "paid fallback comparison" },
  { key: "DATAFORSEO_PASSWORD", purpose: "paid fallback comparison" },
];

const REQUIRED_MIGRATIONS = [
  "0082_keyword_cpc_cache",
  "0083_benchmark_runs",
  "0084_report_quality_violations",
];

function checkMigrations() {
  if (!existsSync(combinedPath)) {
    return { ok: false, missing: ["keyword_cpc_cache", "benchmark_runs", "report_quality_violations"] };
  }
  const sql = readFileSync(combinedPath, "utf8");
  const tables = ["keyword_cpc_cache", "benchmark_runs", "report_quality_violations"];
  const missing = tables.filter((t) => !sql.includes(t));
  return { ok: missing.length === 0, missing };
}

function main() {
  console.log("=== Staging proof readiness ===\n");

  let warnings = 0;
  let errors = 0;

  console.log("Required environment variables:");
  for (const { key, purpose } of REQUIRED_ENV) {
    const val = process.env[key];
    const present = Boolean(val && val.length > 0 && !val.startsWith("your-"));
    if (present) {
      console.log(`  [ok] ${key} — ${purpose}`);
    } else {
      console.log(`  [missing] ${key} — ${purpose}`);
      warnings++;
    }
  }

  console.log("\nOptional (fallback comparison):");
  for (const { key, purpose } of OPTIONAL_ENV) {
    const val = process.env[key];
    const present = Boolean(val && val.length > 0);
    console.log(`  [${present ? "ok" : "optional"}] ${key} — ${purpose}`);
  }

  console.log("\nMigration tables (combined.sql):");
  const mig = checkMigrations();
  if (mig.ok) {
    console.log("  [ok] keyword_cpc_cache, benchmark_runs, report_quality_violations present");
  } else {
    console.log(`  [missing] ${mig.missing.join(", ")}`);
    errors++;
  }

  console.log("\nLive benchmark check:");
  if (process.env.RUN_LIVE_BENCHMARK_CHECK === "1") {
    console.log("  [info] RUN_LIVE_BENCHMARK_CHECK=1 — live provider smoke is OUT OF SCOPE for this script.");
    console.log("         Use docs/audits/staging-benchmark-runbook.md for manual Inngest trigger.");
  } else {
    console.log("  [skip] No paid provider calls (set RUN_LIVE_BENCHMARK_CHECK=1 only for manual smoke)");
  }

  console.log("\nBenchmark evidence:");
  console.log("  [warn] Live benchmark proof has not started until benchmark_runs contains real rows from staging cron.");
  warnings++;

  console.log(`\nSummary: ${errors} error(s), ${warnings} warning(s)`);
  if (errors > 0) {
    process.exit(1);
  }
  console.log("OK — configuration check complete (warnings expected without staging secrets).");
}

main();
