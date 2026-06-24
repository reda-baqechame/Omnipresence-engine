import pg from "pg";

const conn = process.env.POSTGRES_URL_NON_POOLING;
const client = new pg.Client({
  connectionString: conn.includes("sslmode=") ? conn : `${conn}?sslmode=no-verify`,
});
await client.connect();

const triggers = await client.query(`
  SELECT tgname, relname
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'auth' AND NOT t.tgisinternal
`);
console.log("Auth triggers:", triggers.rows);

const hooks = await client.query(`SELECT * FROM auth.hooks LIMIT 5`).catch((e) => ({ rows: [], error: e.message }));
console.log("Auth hooks:", hooks.rows?.length ?? hooks.error);

const instances = await client.query(`SELECT id, raw_base_config FROM auth.instances LIMIT 1`);
if (instances.rows[0]) {
  const cfg = instances.rows[0].raw_base_config;
  console.log("Site URL:", cfg?.site_url);
  console.log("URI allow list:", cfg?.uri_allow_list);
  console.log("Mailer autoconfirm:", cfg?.mailer_autoconfirm);
}

await client.end();
