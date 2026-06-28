import pg from "pg";

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

// Migrations that were marked applied by an old bootstrap heuristic but whose
// tables were never actually created (verified missing via inspect-db). Clearing
// these recorded rows lets run-migration.mjs re-run them idempotently and create
// the missing tables. All four use CREATE TABLE/INDEX IF NOT EXISTS and the
// canonical memberships-based RLS, so re-running is safe.
const TO_RESET = [
  "0011_guarantee.sql",
  "0012_phase2.sql",
  "0013_backlink_snapshots.sql",
  "0014_project_integrations.sql",
];

const client = new pg.Client({ connectionString: conn });
await client.connect();
const res = await client.query(
  "DELETE FROM schema_migrations WHERE id = ANY($1) RETURNING id",
  [TO_RESET]
);
console.log("Cleared recorded migrations:", res.rows.map((r) => r.id).join(", ") || "(none)");
await client.end();
