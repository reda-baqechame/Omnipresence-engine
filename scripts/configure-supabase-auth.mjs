import pg from "pg";

const conn = process.env.POSTGRES_URL_NON_POOLING;
const client = new pg.Client({
  connectionString: conn.includes("sslmode=") ? conn : `${conn}?sslmode=no-verify`,
});
await client.connect();

const siteUrl = "https://omnipresence-engine.vercel.app";
const allowList = `${siteUrl}/**,http://localhost:3000/**`;

await client.query(`
  UPDATE auth.instances
  SET raw_base_config = (
    CASE
      WHEN raw_base_config IS NULL THEN '{}'::jsonb
      WHEN pg_typeof(raw_base_config)::text = 'jsonb' THEN raw_base_config
      ELSE raw_base_config::jsonb
    END
  ) || jsonb_build_object(
    'site_url', $1::text,
    'uri_allow_list', $2::text,
    'mailer_autoconfirm', true
  )
`, [siteUrl, allowList]);

console.log("Updated auth.instances site_url + autoconfirm");
await client.end();
