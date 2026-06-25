import pg from "pg";

const conn = process.env.POSTGRES_URL_NON_POOLING;
const client = new pg.Client({
  connectionString: conn.includes("sslmode=") ? conn : `${conn}?sslmode=no-verify`,
});
await client.connect();

const policies = await client.query(`
  SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS qual, pg_get_expr(polwithcheck, polrelid) AS with_check
  FROM pg_policy WHERE polrelid = 'public.profiles'::regclass
`);
console.log("RLS policies on profiles:", policies.rows);

const constraints = await client.query(`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass
`);
console.log("Constraints:", constraints.rows);

const rls = await client.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profiles'::regclass`);
console.log("RLS enabled:", rls.rows[0]);

await client.end();
