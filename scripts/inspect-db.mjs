import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "../supabase/migrations");

const raw =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL;
if (!raw) {
  console.error("No connection string");
  process.exit(1);
}
const conn = raw.includes("sslmode=")
  ? raw.replace(/sslmode=[^&]+/, "sslmode=no-verify")
  : `${raw}${raw.includes("?") ? "&" : "?"}sslmode=no-verify`;

const client = new pg.Client({ connectionString: conn });
await client.connect();

const { rows: tables } = await client.query(
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
);
const live = new Set(tables.map((r) => r.tablename));

// Parse every CREATE TABLE [IF NOT EXISTS] <name> from migration files (skip combined.sql).
const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

const expected = new Map(); // table -> first migration that creates it
const reTable = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;
for (const f of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, f), "utf8");
  let m;
  while ((m = reTable.exec(sql)) !== null) {
    const name = m[1].toLowerCase();
    if (!expected.has(name)) expected.set(name, f);
  }
}

const missing = [...expected.entries()].filter(([t]) => !live.has(t));
console.log(`\n=== live tables: ${live.size} | expected tables: ${expected.size} ===`);
console.log(`\n=== MISSING tables (${missing.length}) ===`);
for (const [t, f] of missing) console.log(`  ✗ ${t}   (from ${f})`);

let applied = [];
if (live.has("schema_migrations")) {
  const r = await client.query("SELECT id FROM schema_migrations ORDER BY id");
  applied = r.rows.map((x) => x.id);
}
const appliedSet = new Set(applied);
const unapplied = files.filter((f) => !appliedSet.has(f));
console.log(`\n=== migrations recorded applied: ${applied.length} | unapplied files: ${unapplied.length} ===`);
console.log("UNAPPLIED:", unapplied.join(", ") || "(none)");

// helper function presence
const { rows: fn } = await client.query(
  "SELECT proname FROM pg_proc WHERE proname='get_user_org_ids'"
);
console.log(`\nget_user_org_ids(): ${fn.length ? "present" : "MISSING"}`);

await client.end();
