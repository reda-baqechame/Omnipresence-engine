#!/usr/bin/env node
/**
 * Run attribution sync for a project (service-role, direct import).
 * Usage: node --import ./tests/_lib/register-loader.mjs scripts/oauth-sync-runner.mjs [projectId]
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.providers", ".env.local", ".env.production.local"]) {
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

const projectId = process.argv[2] || "b1055406-874d-4f5b-975a-9be1bf6aabbf";
const { syncProjectAttribution } = await import("../src/lib/engines/attribution-sync.ts");

const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const result = await syncProjectAttribution(service, projectId);
console.log(JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);
