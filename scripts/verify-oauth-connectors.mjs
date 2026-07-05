#!/usr/bin/env node
/**
 * Verify GSC + GA4 OAuth connectors for a project (service-role DB read).
 *
 * Usage:
 *   node scripts/verify-oauth-connectors.mjs [projectId]
 *   PROJECT_ID=... node scripts/verify-oauth-connectors.mjs --require
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const requireOk = args.includes("--require");
const projectId =
  args.find((a) => !a.startsWith("--")) ||
  process.env.PROJECT_ID ||
  "b1055406-874d-4f5b-975a-9be1bf6aabbf";

for (const file of [".env.providers", ".env.local", ".env.production.local"]) {
  const p = join(root, file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("\nverify-oauth-connectors: need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY\n");
  process.exit(1);
}

const supabase = createClient(url, key);
const googleId = process.env.GOOGLE_CLIENT_ID;
const googleSecret = process.env.GOOGLE_CLIENT_SECRET;

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ○ ${m}`);
const bad = (m) => {
  console.log(`  ✗ ${m}`);
  failures++;
};

console.log(`\n=== verify-oauth-connectors ===`);
console.log(`  project: ${projectId}\n`);

console.log("Vercel / local OAuth env");
if (googleId && googleSecret && !googleId.startsWith("your-")) ok("GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET configured");
else bad("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing — OAuth connect buttons will fail");

const { data: connections } = await supabase
  .from("oauth_connections")
  .select("provider, access_token, expires_at, updated_at")
  .eq("project_id", projectId);

const byProvider = new Map((connections || []).map((c) => [c.provider, c]));

for (const provider of ["google_search_console", "google_analytics"]) {
  const conn = byProvider.get(provider);
  const label = provider === "google_search_console" ? "GSC" : "GA4";
  if (!conn?.access_token) {
    bad(`${label} not connected — visit /api/oauth?provider=${provider}&projectId=${projectId}`);
    continue;
  }
  const expired = conn.expires_at && new Date(conn.expires_at).getTime() < Date.now();
  if (expired) bad(`${label} token expired — re-connect OAuth`);
  else ok(`${label} connected (token present)`);
}

const { data: metric } = await supabase
  .from("attribution_metrics")
  .select("source_availability, last_checked_at, revenue")
  .eq("project_id", projectId)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (metric) {
  const avail = metric.source_availability && typeof metric.source_availability === "object"
    ? metric.source_availability
    : {};
  if (avail.google_analytics) ok("GA4 attribution sync returned data");
  else warn("GA4 connected but last sync had no GA data — run /api/attribution/sync");
  if (avail.google_search_console) ok("GSC data available in attribution");
  else if (byProvider.get("google_search_console")) warn("GSC connected but not in latest attribution availability");
} else if (byProvider.get("google_analytics")) {
  warn("No attribution_metrics row — run /api/attribution/sync after GA4 connect");
}

console.log("");
if (failures > 0) {
  console.log(`${failures} OAuth check(s) failed.\n`);
  if (requireOk) process.exit(1);
} else {
  console.log("OAuth connectors OK.\n");
}
