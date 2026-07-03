#!/usr/bin/env node
/** Disable email confirmation requirement on Supabase Auth. */
import pg from "pg";
import { loadEnvFile } from "./load-vercel-env.mjs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env.migrate.tmp"), true);

const raw = process.env.POSTGRES_URL_NON_POOLING;
if (!raw) {
  console.error("POSTGRES_URL_NON_POOLING missing");
  process.exit(1);
}
const conn = raw.includes("sslmode=")
  ? raw.replace(/sslmode=[^&]+/, "sslmode=no-verify")
  : `${raw}${raw.includes("?") ? "&" : "?"}sslmode=no-verify`;

const client = new pg.Client({ connectionString: conn });
await client.connect();

const siteUrl = "https://omnipresence-engine.vercel.app";
const allowList = `${siteUrl}/**,http://localhost:3000/**`;

// Supabase Auth config table (GoTrue v2+)
try {
  const cfg = await client.query(`SELECT * FROM auth.config LIMIT 1`);
  console.log("auth.config columns:", cfg.fields?.map((f) => f.name).join(", ") || "n/a");
  if (cfg.rows.length) {
    await client.query(
      `UPDATE auth.config SET
        site_url = $1,
        uri_allow_list = $2,
        enable_confirmations = false,
        mailer_autoconfirm = true
       WHERE true`,
      [siteUrl, allowList]
    );
    console.log("✓ Updated auth.config (enable_confirmations=false, mailer_autoconfirm=true)");
  }
} catch (e) {
  console.log("auth.config update:", e.message);
}

// Legacy instances table fallback
try {
  const col = await client.query(`
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'instances' AND column_name = 'raw_base_config'
  `);
  const type = col.rows[0]?.data_type;
  const patch = { site_url: siteUrl, uri_allow_list: allowList, mailer_autoconfirm: true };
  if (type === "jsonb") {
    await client.query(
      `UPDATE auth.instances SET raw_base_config = COALESCE(raw_base_config, '{}'::jsonb) || $1::jsonb`,
      [JSON.stringify(patch)]
    );
  } else {
    await client.query(`UPDATE auth.instances SET raw_base_config = $1`, [JSON.stringify(patch)]);
  }
  console.log("✓ Updated auth.instances raw_base_config");
} catch (e) {
  console.log("auth.instances update:", e.message);
}

const users = await client.query(
  `UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()) WHERE email_confirmed_at IS NULL RETURNING email`
);
console.log(`✓ Auto-confirmed ${users.rowCount} pending user(s)`);

await client.end();
console.log("\nDone — new signups should receive a session immediately.\n");
