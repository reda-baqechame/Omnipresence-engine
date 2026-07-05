#!/usr/bin/env node
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.providers", ".env.local", ".env.migrate.tmp"]) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
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

const email = (process.argv[2] || "redabaquechame58@gmail.com").trim().toLowerCase();
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUser(email) {
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
  return null;
}

const user = await findUser(email);
if (!user) throw new Error(`User not found: ${email}`);

const { data: members } = await service
  .from("memberships")
  .select("id, organization_id, role, organizations(id,name,slug)")
  .eq("user_id", user.id);

const orgIds = (members || []).map((m) => m.organization_id);
const { data: projects } = orgIds.length
  ? await service.from("projects").select("id,name,domain,organization_id").in("organization_id", orgIds)
  : { data: [] };

console.log(JSON.stringify({ userId: user.id, memberships: members, projects }, null, 2));

// Remove empty org memberships (no projects) when user also has orgs with projects
const orgsWithProjects = new Set((projects || []).map((p) => p.organization_id));
const emptyMemberships = (members || []).filter((m) => !orgsWithProjects.has(m.organization_id));
if (emptyMemberships.length && orgsWithProjects.size > 0) {
  for (const m of emptyMemberships) {
    await service.from("memberships").delete().eq("id", m.id);
    console.log(`Removed empty membership ${m.id} org=${m.organization_id}`);
  }
}
