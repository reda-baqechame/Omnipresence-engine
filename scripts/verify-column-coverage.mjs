#!/usr/bin/env node
/**
 * Column-level schema verifier.
 *
 * Catches the class of silent production bug where code queries a column that
 * does not exist on the table (Supabase returns a runtime error that is often
 * swallowed by `.catch`/optional chaining). Complements verify-table-coverage.
 *
 * Heuristic + conservative: it only flags simple identifier columns used in
 * .select("a, b"), .eq/.neq/.gt/.gte/.lt/.lte/.like/.ilike/.is/.in/.contains/
 * .order/.filter("col", ...). It deliberately SKIPS:
 *   - select tokens containing * ( ) : -> ! , spaces (embeds/aliases/jsonb)
 *   - dynamic column names (variables, template strings)
 *   - tables not defined in combined.sql (handled by verify-table-coverage)
 *
 * False positives can be silenced via the IGNORE set below.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const rawSql = fs.readFileSync(path.join(root, "supabase/migrations/combined.sql"), "utf8");
// Strip SQL comments so inline `-- ...` notes between columns don't hide them.
const sql = rawSql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

// (table, column) pairs that are known-good but the heuristic can't see
// (e.g. columns added by raw ALTER in a way the parser misses). Format: "table.column".
const IGNORE = new Set([]);

// ---- Parse schema: columns per table from CREATE TABLE + ALTER TABLE ADD COLUMN ----
const tableColumns = new Map(); // table -> Set(columns)

function ensure(table) {
  const t = table.toLowerCase();
  if (!tableColumns.has(t)) tableColumns.set(t, new Set());
  return tableColumns.get(t);
}

const RESERVED_LEADERS = new Set([
  "primary", "unique", "foreign", "constraint", "check", "exclude", "like", "create",
]);

// CREATE TABLE blocks
const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(([\s\S]*?)\n\)\s*;/gi;
let cm;
while ((cm = createRe.exec(sql))) {
  const table = cm[1];
  const body = cm[2];
  const cols = ensure(table);
  // Split on top-level commas (depth 0).
  let depth = 0;
  let cur = "";
  const parts = [];
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const part of parts) {
    const line = part.trim();
    if (!line) continue;
    const m = line.match(/^"?([a-z0-9_]+)"?\s+/i);
    if (!m) continue;
    const name = m[1].toLowerCase();
    if (RESERVED_LEADERS.has(name)) continue;
    cols.add(name);
  }
}

// ALTER TABLE <t> ... ; capturing EVERY `ADD COLUMN [IF NOT EXISTS] col` in the
// statement (multi-column ALTERs add several columns at once).
const alterStmtRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?([\s\S]*?);/gi;
let asm;
while ((asm = alterStmtRe.exec(sql))) {
  const table = asm[1];
  const body = asm[2];
  const addRe = /add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi;
  let ad;
  while ((ad = addRe.exec(body))) ensure(table).add(ad[1].toLowerCase());
}

// ---- Walk source ----
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FILTER_METHODS = "eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|order|filter";
const filterRe = new RegExp(`\\.(?:${FILTER_METHODS})\\(\\s*["'\`]([a-z0-9_]+)["'\`]`, "gi");

function badSelectToken(tok) {
  return (
    !tok ||
    /[*(){}:!]/.test(tok) ||
    tok.includes("->") ||
    tok.includes(" ") ||
    !/^[a-z0-9_]+$/i.test(tok)
  );
}

const findings = [];

for (const file of walk(path.join(root, "src"))) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  // Locate each `.from("table")` and analyze the chained call window up to the
  // next `.from(` or 700 chars, whichever is first.
  const fromRe = /\.from\(\s*["'`]([a-z0-9_]+)["'`]\s*\)/gi;
  let fm;
  while ((fm = fromRe.exec(text))) {
    const table = fm[1].toLowerCase();
    const cols = tableColumns.get(table);
    if (!cols || cols.size === 0) continue; // unknown table -> table verifier's job
    const start = fm.index + fm[0].length;
    const nextFrom = text.indexOf(".from(", start);
    const end = nextFrom >= 0 ? Math.min(nextFrom, start + 700) : start + 700;
    const window = text.slice(start, end);

    // .select("...") static string args
    const selRe = /\.select\(\s*["'`]([^"'`]*)["'`]/gi;
    let sm;
    while ((sm = selRe.exec(window))) {
      const arg = sm[1];
      if (arg.includes("(")) continue; // embedded resource select -> skip whole arg
      for (const raw of arg.split(",")) {
        const tok = raw.trim();
        if (badSelectToken(tok)) continue;
        const col = tok.toLowerCase();
        if (!cols.has(col) && !IGNORE.has(`${table}.${col}`)) {
          findings.push({ file: rel, table, col, kind: "select" });
        }
      }
    }

    // filter/order methods
    let qm;
    while ((qm = filterRe.exec(window))) {
      const col = qm[1].toLowerCase();
      if (!cols.has(col) && !IGNORE.has(`${table}.${col}`)) {
        findings.push({ file: rel, table, col, kind: "filter" });
      }
    }
  }
}

// Dedup
const seen = new Set();
const unique = findings.filter((f) => {
  const k = `${f.file}|${f.table}|${f.col}|${f.kind}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

console.log(`Tables parsed from combined.sql: ${tableColumns.size}`);
console.log(`Suspicious (table, column) usages: ${unique.length}`);

if (unique.length === 0) {
  console.log("\nOK: no queries reference unknown columns.");
  process.exit(0);
}

// Group by table.column for readability.
const byCol = new Map();
for (const f of unique) {
  const k = `${f.table}.${f.col}`;
  if (!byCol.has(k)) byCol.set(k, []);
  byCol.get(k).push(`${f.file} (${f.kind})`);
}
console.log("\nPotential unknown-column references:");
for (const [k, locs] of [...byCol.entries()].sort()) {
  console.log(`  - ${k}`);
  for (const loc of [...new Set(locs)].slice(0, 4)) console.log(`      ${loc}`);
}
process.exit(1);
