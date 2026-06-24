import pg from "pg";

const conn = process.env.POSTGRES_URL_NON_POOLING;
const client = new pg.Client({
  connectionString: conn.includes("sslmode=") ? conn : `${conn}?sslmode=no-verify`,
});
await client.connect();
const { rows } = await client.query(
  `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('organizations','projects','visibility_results','results_ledger','ops_queue') ORDER BY tablename`
);
console.log("PresenceOS tables:", rows.map((r) => r.tablename).join(", ") || "NONE");
await client.end();
