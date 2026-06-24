import pg from "pg";

const conn = process.env.POSTGRES_URL_NON_POOLING;
const client = new pg.Client({
  connectionString: conn.includes("sslmode=") ? conn : `${conn}?sslmode=no-verify`,
});
await client.connect();

const owner = await client.query(`
  SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE proname = 'handle_new_user'
`);
console.log("handle_new_user owner:", owner.rows[0]?.owner);

await client.query(`
  DO $$ BEGIN
    CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (id = auth.uid());
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
`);

await client.query(`
  CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $function$
  BEGIN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);
    RETURN NEW;
  END;
  $function$;
`);

console.log("Applied profiles_insert policy + hardened handle_new_user trigger");
await client.end();
