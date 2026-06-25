#!/usr/bin/env node
/** Create a confirmed user via Supabase Admin API (bypasses email rate limit) */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2];
const password = process.argv[3] || "ChangeMe123!@#";
const fullName = process.argv[4] || "Admin User";
const orgName = process.argv[5] || "My Agency";

if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!email) {
  console.error("Usage: node scripts/create-user.mjs <email> [password] [fullName] [orgName]");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName, organization_name: orgName },
});

if (error) {
  console.error("Create user failed:", error.message);
  process.exit(1);
}

console.log("Created user:", data.user?.id, data.user?.email);
console.log("Password:", password);
