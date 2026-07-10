#!/usr/bin/env node
/**
 * Ensures migration 0068 lists every table with a data_source column.
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = join(root, "supabase/migrations/0068_fix_data_source_constraints.sql");

const TABLES_FIVE_VALUE = [
  "visibility_results",
  "technical_findings",
  "coverage_items",
  "authority_opportunities",
  "scores",
  "keyword_opportunities",
  "attribution_metrics",
  "cwv_history",
  "crawl_pages",
  "crawl_issues",
  "rank_snapshots",
  "brand_mentions",
  "product_visibility_snapshots",
  "source_domains",
  "source_mentions",
  "source_opportunities",
  "source_edges",
  "merchant_products",
  "ai_probe_traces",
  "rank_keywords",
  "gsc_snapshots",
  "gsc_query_snapshots",
  "gbp_snapshots",
  "ai_visibility_snapshots",
  "data_quality_scores",
  "behavior_metrics",
  "backlink_graph_snapshots",
  "measurement_evidence",
];

if (!existsSync(migrationPath)) {
  console.error("verify:data-source-constraints — missing 0068_fix_data_source_constraints.sql");
  process.exit(1);
}

const sql = readFileSync(migrationPath, "utf8");
const errors = [];

for (const table of TABLES_FIVE_VALUE) {
  if (!sql.includes(`'${table}'`)) {
    errors.push(`${table}: not listed in 0068 migration`);
  }
}

if (!sql.includes("citation_sources_data_source_check")) {
  errors.push("citation_sources: missing legacy constraint in 0068");
}

const combined = readFileSync(join(root, "supabase/migrations/combined.sql"), "utf8");
if (!combined.includes("0068_fix_data_source_constraints.sql")) {
  errors.push("combined.sql: run node scripts/combine-migrations.mjs");
}

if (errors.length) {
  console.error("verify:data-source-constraints — FAIL\n");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log(
  `verify:data-source-constraints — OK (${TABLES_FIVE_VALUE.length} tables + citation_sources in 0068)`
);
process.exit(0);
