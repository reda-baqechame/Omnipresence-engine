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
  console.error("Set DATABASE_URL or POSTGRES_URL (Supabase → Settings → Database)");
  process.exit(1);
}

const conn = raw.includes("sslmode=")
  ? raw.replace(/sslmode=[^&]+/, "sslmode=no-verify")
  : `${raw}${raw.includes("?") ? "&" : "?"}sslmode=no-verify`;

function listMigrationFiles() {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}

const client = new pg.Client({ connectionString: conn });

try {
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows: applied } = await client.query("SELECT id FROM schema_migrations");
  const appliedSet = new Set(applied.map((r) => r.id));

  const files = listMigrationFiles();
  if (!files.length) {
    console.error("No migration files found.");
    process.exit(1);
  }

  const { rows: tables } = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public'"
  );
  const tableNames = new Set(tables.map((r) => r.tablename));

  if (!appliedSet.size && tableNames.has("organizations")) {
    const pending = files.filter((f) => f < "0015_intelligence.sql");
    for (const file of pending) {
      await client.query(
        "INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING",
        [file]
      );
      appliedSet.add(file);
    }
    console.log("Bootstrapped schema_migrations for existing database.");
  }

  if (!tableNames.has("organizations") && !appliedSet.size) {
    const combined = path.join(migrationsDir, "combined.sql");
    if (fs.existsSync(combined)) {
      const combinedSql = fs.readFileSync(combined, "utf8");
      console.log("Fresh database — applying combined.sql…");
      await client.query(combinedSql);
      // Only mark migrations that are ACTUALLY contained in combined.sql (it can
      // lag behind newly added files). Any newer migration falls through to the
      // per-file loop below so its schema is never silently skipped.
      let marked = 0;
      for (const file of files) {
        if (combinedSql.includes(`========== ${file} ==========`)) {
          await client.query(
            "INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING",
            [file]
          );
          appliedSet.add(file);
          marked++;
        }
      }
      console.log(`Applied combined.sql (${marked} migrations). Checking for newer files…`);
    }
  }

  let count = 0;
  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`Applying ${file}…`);
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
    count++;
  }

  if (!count) {
    console.log("All migrations already applied.");
  } else {
    console.log(`Applied ${count} migration(s).`);
  }
} catch (e) {
  console.error("Migration failed:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
