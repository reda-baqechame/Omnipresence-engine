import pg from "pg";

const conn = process.env.POSTGRES_URL_NON_POOLING.replace(/sslmode=[^&]+/, "sslmode=no-verify");
const client = new pg.Client({ connectionString: conn });
await client.connect();
const { rows } = await client.query(`SELECT * FROM auth.instances LIMIT 1`);
console.log(JSON.stringify(rows[0], null, 2));
await client.end();
