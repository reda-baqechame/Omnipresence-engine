#!/usr/bin/env node
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

const email = (arg("email") || "redabaquechame58@gmail.com").trim().toLowerCase();
const orgId = arg("org");
const projectDomain = arg("domain");

const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(email) {
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
  return null;
}

const user = await findUserByEmail(email);
if (!user) {
  console.error(`User not found: ${email}`);
  process.exit(1);
}

let targetOrgId = orgId;
if (!targetOrgId && projectDomain) {
  const { data: projects, error } = await service
    .from("projects")
    .select("id, name, domain, organization_id")
    .ilike("domain", `%${projectDomain}%`)
    .limit(5);
  if (error) throw error;
  if (!projects?.length) {
    console.error(`No project found for domain containing: ${projectDomain}`);
    process.exit(1);
  }
  targetOrgId = projects[0].organization_id;
  console.log(`Found project ${projects[0].name} (${projects[0].domain}) -> org ${targetOrgId}`);
}

if (!targetOrgId) {
  console.error("Provide --org=<uuid> or --domain=siroccoskin.com");
  process.exit(1);
}

const { data: existing } = await service
  .from("memberships")
  .select("id, role")
  .eq("user_id", user.id)
  .eq("organization_id", targetOrgId)
  .maybeSingle();

if (existing) {
  console.log(`Already member of org ${targetOrgId} (${existing.role})`);
} else {
  const { error } = await service.from("memberships").insert({
    user_id: user.id,
    organization_id: targetOrgId,
    role: "owner",
  });
  if (error) throw error;
  console.log(`Added ${email} as owner of org ${targetOrgId}`);
}

const { data: projects } = await service
  .from("projects")
  .select("id, name, domain, status")
  .eq("organization_id", targetOrgId);
console.log("Projects in org:", projects);
