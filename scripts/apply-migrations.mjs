#!/usr/bin/env node
/**
 * Idempotent SQL migration runner for Railway/production deploys.
 *
 * Applies every supabase/migrations/NNNN_*.sql in lexicographic (numeric) order
 * inside a transaction, tracking applied versions in a `schema_migrations` table
 * so re-runs are safe (a redeploy never re-applies or errors on existing schema).
 *
 * Usage (Railway release/pre-deploy step):
 *   DATABASE_URL=postgres://... node scripts/apply-migrations.mjs
 *
 * Accepts DATABASE_URL or SUPABASE_DB_URL. Excludes combined.sql (a redundant
 * full-schema snapshot — the numbered files are the source of truth). With
 * --dry-run it prints the pending plan without connecting/applying.
 */
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");
const dryRun = process.argv.includes("--dry-run");

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql") && f !== "combined.sql")
  .sort();

if (files.length === 0) {
  console.log("apply-migrations: no migration files found.");
  process.exit(0);
}

if (dryRun) {
  console.log(`apply-migrations (dry-run): ${files.length} migration file(s) in order:`);
  for (const f of files) console.log(`  • ${f}`);
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!connectionString) {
  // Skip-with-warning (exit 0) so this is safe as an always-on pre-deploy step
  // when migrations are managed out-of-band (e.g. Supabase CLI). Pass --required
  // (or set MIGRATIONS_REQUIRED=1) to hard-fail instead.
  const required = process.argv.includes("--required") || process.env.MIGRATIONS_REQUIRED === "1";
  const msg = "apply-migrations: DATABASE_URL/SUPABASE_DB_URL not set — skipping (migrations managed out-of-band).";
  if (required) {
    console.error(msg.replace("skipping", "FAILED (required)"));
    process.exit(1);
  }
  console.warn(msg);
  process.exit(0);
}

const { default: pg } = await import("pg");
const { ensureSchemaMigrationsTable, getAppliedMigrations, markMigrationApplied } = await import(
  "./schema-migrations-utils.mjs"
);
const client = new pg.Client({
  connectionString,
  // Managed Postgres (Supabase/Railway) requires TLS; allow self-signed chains.
  ssl: connectionString.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  await ensureSchemaMigrationsTable(client);
  const applied = await getAppliedMigrations(client);

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    process.stdout.write(`  applying ${file} ... `);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await markMigrationApplied(client, file);
      await client.query("COMMIT");
      console.log("ok");
      count++;
    } catch (err) {
      await client.query("ROLLBACK");
      console.log("FAILED");
      throw new Error(`migration ${file} failed: ${err.message}`);
    }
  }

  console.log(
    count === 0
      ? `apply-migrations: up to date (${files.length} known, all applied).`
      : `apply-migrations: applied ${count} new migration(s).`
  );
}

main()
  .then(() => client.end())
  .catch(async (err) => {
    console.error(`\napply-migrations: ${err.message}`);
    await client.end().catch(() => {});
    process.exit(1);
  });
