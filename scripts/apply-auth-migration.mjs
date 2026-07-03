#!/usr/bin/env node
/** Apply 0010 auth signup fix directly if not already applied. */
import pg from "pg";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.migrate.tmp");
let raw = "";
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  if (line.startsWith("POSTGRES_URL_NON_POOLING=")) {
    raw = line.slice(27).trim().replace(/^"|"$/g, "");
    break;
  }
}
const conn = raw.includes("sslmode=")
  ? raw.replace(/sslmode=[^&]+/, "sslmode=no-verify")
  : `${raw}${raw.includes("?") ? "&" : "?"}sslmode=no-verify`;

const client = new pg.Client({ connectionString: conn });
await client.connect();

const sql = readFileSync(join(root, "supabase/migrations/0010_auth_signup_fix.sql"), "utf8");
await client.query(sql);
console.log("✓ Applied 0010_auth_signup_fix.sql");

const pol = await client.query(
  `SELECT policyname FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'profiles_insert'`
);
console.log("profiles_insert policy:", pol.rows.length ? "exists" : "missing");

await client.end();
