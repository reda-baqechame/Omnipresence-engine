#!/usr/bin/env node
// Cross-checks every Supabase table referenced via `.from("...")` in the app
// against the tables actually created in supabase/migrations/combined.sql.
// Exits non-zero if any referenced table is missing from the combined migration.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sql = fs.readFileSync(path.join(root, "supabase/migrations/combined.sql"), "utf8");

const created = new Set(
  [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)].map((m) =>
    m[1].toLowerCase()
  )
);

// PostgREST views/RPCs that the app may .from() but that aren't CREATE TABLE.
const KNOWN_NON_TABLES = new Set([]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const refs = new Map(); // table -> sample file
const fromRe = /\.from\(\s*["'`]([a-z0-9_]+)["'`]\s*\)/gi;
for (const file of walk(path.join(root, "src"))) {
  const text = fs.readFileSync(file, "utf8");
  let m;
  while ((m = fromRe.exec(text))) {
    const t = m[1].toLowerCase();
    if (!refs.has(t)) refs.set(t, path.relative(root, file));
  }
}

const missing = [...refs.keys()]
  .filter((t) => !created.has(t) && !KNOWN_NON_TABLES.has(t))
  .sort();

console.log(`Tables created in combined.sql: ${created.size}`);
console.log(`Distinct tables referenced in src: ${refs.size}`);

if (missing.length === 0) {
  console.log("\nOK: every referenced table exists in combined.sql.");
  process.exit(0);
}

console.log(`\nMISSING (${missing.length}) — referenced in code but not created in combined.sql:`);
for (const t of missing) console.log(`  - ${t}  (e.g. ${refs.get(t)})`);
process.exit(1);
