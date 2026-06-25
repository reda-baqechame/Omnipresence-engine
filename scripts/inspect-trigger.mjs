import pg from "pg";

const conn = process.env.POSTGRES_URL_NON_POOLING;
const client = new pg.Client({
  connectionString: conn.includes("sslmode=") ? conn : `${conn}?sslmode=no-verify`,
});
await client.connect();

const fn = await client.query(`
  SELECT pg_get_functiondef(p.oid) AS def
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'handle_new_user' OR p.proname LIKE '%auth_user%'
  LIMIT 5
`);
for (const row of fn.rows) console.log(row.def, "\n---");

const trig = await client.query(`
  SELECT pg_get_triggerdef(oid) AS def
  FROM pg_trigger WHERE tgname = 'on_auth_user_created'
`);
console.log("Trigger:", trig.rows[0]?.def);

await client.end();
