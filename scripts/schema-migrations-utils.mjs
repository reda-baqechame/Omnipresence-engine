/**
 * Shared schema_migrations helpers — all migration scripts use `version` as the
 * primary key column. Legacy databases bootstrapped via run-migration.mjs may
 * still have an `id` column; reconcile once before any read/write.
 */

/**
 * @param {import("pg").Client} client
 */
export async function ensureSchemaMigrationsTable(client) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`
  );

  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'schema_migrations'`
  );
  const cols = new Set(rows.map((r) => r.column_name));

  if (cols.has("id") && !cols.has("version")) {
    await client.query(`ALTER TABLE schema_migrations RENAME COLUMN id TO version`);
    return;
  }

  if (cols.has("id") && cols.has("version")) {
    await client.query(
      `INSERT INTO schema_migrations (version, applied_at)
       SELECT id, applied_at FROM schema_migrations
       WHERE id IS NOT NULL
       ON CONFLICT (version) DO NOTHING`
    );
    await client.query(`ALTER TABLE schema_migrations DROP COLUMN id`);
  }
}

/**
 * @param {import("pg").Client} client
 * @returns {Promise<Set<string>>}
 */
export async function getAppliedMigrations(client) {
  await ensureSchemaMigrationsTable(client);
  const { rows } = await client.query("SELECT version FROM schema_migrations");
  return new Set(rows.map((r) => r.version));
}

/**
 * @param {import("pg").Client} client
 * @param {string} file
 */
export async function markMigrationApplied(client, file) {
  await client.query(
    "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
    [file]
  );
}
