import pg from "pg";

const conn = process.env.POSTGRES_URL_NON_POOLING;
const client = new pg.Client({
  connectionString: conn.includes("sslmode=") ? conn : `${conn}?sslmode=no-verify`,
});
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
