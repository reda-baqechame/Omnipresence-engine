import pg from "pg";

const conn = process.env.POSTGRES_URL_NON_POOLING;
const normalized = conn.replace(/sslmode=[^&]+/, "sslmode=no-verify").includes("sslmode=")
  ? conn.replace(/sslmode=[^&]+/, "sslmode=no-verify")
  : `${conn}?sslmode=no-verify`;
const client = new pg.Client({ connectionString: normalized });
await client.connect();

const siteUrl = "https://omnipresence-engine.vercel.app";
const allowList = `${siteUrl}/**,http://localhost:3000/**`;

const col = await client.query(`
  SELECT data_type FROM information_schema.columns
  WHERE table_schema = 'auth' AND table_name = 'instances' AND column_name = 'raw_base_config'
`);
const type = col.rows[0]?.data_type;
console.log("raw_base_config type:", type);

if (type === "jsonb") {
  await client.query(
    `UPDATE auth.instances SET raw_base_config = COALESCE(raw_base_config, '{}'::jsonb) || $1::jsonb`,
    [JSON.stringify({ site_url: siteUrl, uri_allow_list: allowList, mailer_autoconfirm: true })]
  );
} else {
  await client.query(
    `UPDATE auth.instances SET raw_base_config = $1`,
    [JSON.stringify({ site_url: siteUrl, uri_allow_list: allowList, mailer_autoconfirm: true })]
  );
}

console.log("Updated auth redirect + autoconfirm");
await client.end();
