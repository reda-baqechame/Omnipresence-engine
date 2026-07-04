#!/usr/bin/env node
/**
 * Repair a production Supabase user:
 * - find or create the auth user
 * - set/rotate password
 * - confirm email
 * - ensure organization + owner membership
 *
 * Usage:
 *   node scripts/admin-user-repair.mjs --email=user@example.com --password='NewPass123!' --org='My Agency'
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(file) {
  const path = join(root, file);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

for (const file of [".env.providers", ".env.local", ".env.migrate.tmp"]) loadEnv(file);

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : "";
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function generatedPassword() {
  return `OmniReset!${Date.now().toString(36)}Aa1`;
}

async function findUserByEmail(admin, email) {
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
  return null;
}

const email = arg("email").trim().toLowerCase();
const password = arg("password") || generatedPassword();
const fullName = arg("name") || "Owner";
const orgName = (arg("org") || `${fullName}'s Agency`).trim().slice(0, 120);

if (!email || !email.includes("@")) {
  console.error("Missing --email=user@example.com");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters");
  process.exit(1);
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let user = await findUserByEmail(service, email);
if (!user) {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, pending_org_name: orgName },
  });
  if (error || !data.user) throw error || new Error("createUser returned no user");
  user = data.user;
  console.log(`✓ Created user ${email}`);
} else {
  const { data, error } = await service.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
    user_metadata: {
      ...(user.user_metadata || {}),
      full_name: user.user_metadata?.full_name || fullName,
      pending_org_name: user.user_metadata?.pending_org_name || orgName,
    },
  });
  if (error || !data.user) throw error || new Error("updateUserById returned no user");
  user = data.user;
  console.log(`✓ Updated user ${email}`);
}

const { data: existingMembership, error: membershipLookupError } = await service
  .from("memberships")
  .select("id, organization_id")
  .eq("user_id", user.id)
  .limit(1);
if (membershipLookupError) throw membershipLookupError;

let organizationId = existingMembership?.[0]?.organization_id;
if (!organizationId) {
  const slug = `${slugify(orgName)}-${Date.now().toString(36)}`;
  const { data: org, error: orgError } = await service
    .from("organizations")
    .insert({ name: orgName, slug, api_credit_limit: 9999999 })
    .select()
    .single();
  if (orgError || !org) throw orgError || new Error("organization insert returned no row");
  organizationId = org.id;
  const { error: memberError } = await service.from("memberships").insert({
    organization_id: organizationId,
    user_id: user.id,
    role: "owner",
  });
  if (memberError) throw memberError;
  console.log(`✓ Created organization + owner membership: ${org.name}`);
} else {
  console.log(`✓ Existing membership found: ${organizationId}`);
}

console.log("\nRepair complete");
console.log(`Email: ${email}`);
console.log(`Temporary password: ${password}`);
console.log("Sign in at: https://omnipresence-engine.vercel.app/login");
