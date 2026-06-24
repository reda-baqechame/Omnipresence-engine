import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const conn =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL;

if (!conn) {
  console.error("Set DATABASE_URL or POSTGRES_URL");
  process.exit(1);
}

const sql = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/combined.sql"),
  "utf8"
);

const client = new pg.Client({
  connectionString: conn.includes("sslmode=") ? conn : `${conn}${conn.includes("?") ? "&" : "?"}sslmode=no-verify`,
});

try {
  await client.connect();
  const { rows } = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
  );
  console.log("Existing tables:", rows.map((r) => r.tablename).join(", ") || "(none)");
  if (rows.some((r) => r.tablename === "organizations")) {
    console.log("Schema already applied (organizations exists). Skipping full migration.");
    process.exit(0);
  }
  console.log("Applying combined.sql...");
  await client.query(sql);
  console.log("Migration complete.");
} catch (e) {
  console.error("Migration failed:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
