#!/usr/bin/env node
/**
 * RLS coverage gate: every CREATE TABLE must have ENABLE ROW LEVEL SECURITY,
 * and every RLS-enabled table must have at least one CREATE POLICY unless it is
 * on the explicit service-role-only allowlist.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const combined = readFileSync(join(root, "supabase/migrations/combined.sql"), "utf8");

/** Tables intentionally without user-facing policies (service-role ingest only). */
const POLICY_ALLOWLIST = new Set([
  "webhook_events",
  "api_spend_daily",
  "keyword_cpc_cache",
  "benchmark_runs",
  "report_quality_violations",
  // Global cross-tenant grounded-probe cache (0092): rows are engine answers
  // to prompts, no tenant data; only the server-side scanner reads/writes.
  "probe_cache",
]);

function extractTables(sql) {
  const tables = [];
  const re = /CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)/gi;
  let m;
  while ((m = re.exec(sql))) tables.push(m[1]);
  return [...new Set(tables)];
}

function hasRls(sql, table) {
  const re = new RegExp(`ALTER TABLE (?:ONLY )?(?:public\\.)?${table}\\s+ENABLE ROW LEVEL SECURITY`, "i");
  return re.test(sql);
}

function policyCount(sql, table) {
  const re = new RegExp(`CREATE POLICY [^\\n]+\\s+ON (?:public\\.)?${table}\\b`, "gi");
  return (sql.match(re) || []).length;
}

const tables = extractTables(combined);
const errors = [];

for (const table of tables) {
  if (!hasRls(combined, table)) {
    errors.push(`${table}: missing ENABLE ROW LEVEL SECURITY`);
    continue;
  }
  const policies = policyCount(combined, table);
  if (policies === 0 && !POLICY_ALLOWLIST.has(table)) {
    errors.push(`${table}: RLS enabled but zero policies (not on allowlist)`);
  }
}

console.log(`verify:rls-coverage — ${tables.length} tables, ${errors.length} issue(s)`);
if (errors.length) {
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("verify:rls-coverage — OK");
process.exit(0);
