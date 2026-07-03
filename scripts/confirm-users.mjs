import pg from "pg";
import { loadEnvFile } from "./load-vercel-env.mjs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env.migrate.tmp"), true);

const raw = process.env.POSTGRES_URL_NON_POOLING;
const conn = raw.replace(/sslmode=[^&]+/, "sslmode=no-verify").includes("sslmode=")
  ? raw.replace(/sslmode=[^&]+/, "sslmode=no-verify")
  : `${raw}?sslmode=no-verify`;
const client = new pg.Client({ connectionString: conn });
await client.connect();

const users = await client.query(
  `SELECT id, email, email_confirmed_at, created_at FROM auth.users ORDER BY created_at DESC LIMIT 5`
);
console.log("Recent users:", users.rows);

// Auto-confirm pending users for production bootstrap
await client.query(
  `UPDATE auth.users SET email_confirmed_at = NOW() WHERE email_confirmed_at IS NULL`
);
console.log("Auto-confirmed unconfirmed users");

await client.end();
