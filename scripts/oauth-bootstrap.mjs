#!/usr/bin/env node
/**
 * Bootstrap GSC + GA4 OAuth for a project.
 *
 * Paths (in order):
 *   1. Already connected → sync attribution → exit 0
 *   2. GOOGLE_OAUTH_REFRESH_TOKEN env → inject tokens → sync → exit 0
 *   3. Open OAuth URLs in browser → poll DB until connected (up to 10 min)
 *
 * Usage:
 *   node scripts/oauth-bootstrap.mjs
 *   node scripts/oauth-bootstrap.mjs --project <id> --base <url>
 */
import { spawn, spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const projectId = arg("--project") || process.env.PROJECT_ID || "b1055406-874d-4f5b-975a-9be1bf6aabbf";
const base = (arg("--base") || process.env.SMOKE_BASE_URL || "https://omnipresence-engine.vercel.app").replace(/\/$/, "");
const pollMs = Number(arg("--poll-ms") || 5000);
const timeoutMs = Number(arg("--timeout-ms") || 600_000);

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("oauth-bootstrap: need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const PROVIDERS = ["google_search_console", "google_analytics"];

async function getConnections() {
  const { data } = await supabase
    .from("oauth_connections")
    .select("provider, access_token, expires_at")
    .eq("project_id", projectId);
  const map = new Map((data || []).map((c) => [c.provider, c]));
  return map;
}

function isConnected(map, provider) {
  const c = map.get(provider);
  if (!c?.access_token) return false;
  if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return false;
  return true;
}

function missingProviders(map) {
  return PROVIDERS.filter((p) => !isConnected(map, p));
}

async function exchangeRefreshToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`refresh token exchange failed: ${res.status}`);
  return res.json();
}

async function injectFromRefreshToken(refreshToken) {
  const tokens = await exchangeRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  for (const provider of PROVIDERS) {
    await supabase.from("oauth_connections").upsert(
      {
        project_id: projectId,
        provider,
        access_token: tokens.access_token,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        metadata: {},
      },
      { onConflict: "project_id,provider" }
    );
  }
  console.log("  ✓ Injected GSC + GA4 tokens from GOOGLE_OAUTH_REFRESH_TOKEN");
}

function openBrowser(targetUrl) {
  if (process.env.OAUTH_SKIP_BROWSER === "1") {
    console.log(`  → Open manually: ${targetUrl}`);
    return;
  }
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", targetUrl], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [targetUrl], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [targetUrl], { detached: true, stdio: "ignore" }).unref();
  }
  console.log(`  → Opened browser: ${targetUrl}`);
}

function runSync() {
  console.log("\n>>> attribution sync\n");
  const r = spawnSync(
    "node",
    ["--import", "./tests/_lib/register-loader.mjs", "scripts/oauth-sync-runner.mjs", projectId],
    { cwd: root, encoding: "utf8", stdio: "inherit", shell: true }
  );
  return r.status === 0;
}

function runVerify(requireOk) {
  const verifyArgs = ["scripts/verify-oauth-connectors.mjs", projectId];
  if (requireOk) verifyArgs.push("--require");
  const r = spawnSync("node", verifyArgs, { cwd: root, encoding: "utf8", stdio: "inherit", shell: true });
  return r.status === 0;
}

async function waitForConnections(initialMissing) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const map = await getConnections();
    const still = initialMissing.filter((p) => !isConnected(map, p));
    if (still.length === 0) return true;
    console.log(`  … waiting for: ${still.join(", ")} (${Math.round((deadline - Date.now()) / 1000)}s left)`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

console.log(`\n=== oauth-bootstrap ===`);
console.log(`  project: ${projectId}`);
console.log(`  base: ${base}\n`);

let map = await getConnections();
let missing = missingProviders(map);

if (missing.length === 0) {
  console.log("  ✓ GSC + GA4 already connected");
} else if (process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
  try {
    await injectFromRefreshToken(process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
    map = await getConnections();
    missing = missingProviders(map);
  } catch (e) {
    console.error(`  ✗ Refresh token inject failed: ${e.message}`);
    process.exit(1);
  }
}

if (missing.length > 0) {
  console.log(`\nMissing connectors: ${missing.join(", ")}`);
  console.log("Opening OAuth flows — complete Google consent in the browser window.\n");
  for (const provider of missing) {
    const oauthUrl = `${base}/api/oauth?provider=${provider}&projectId=${projectId}`;
    openBrowser(oauthUrl);
    await new Promise((r) => setTimeout(r, 2000));
  }
  const ok = await waitForConnections(missing);
  if (!ok) {
    console.error("\noauth-bootstrap: timed out waiting for OAuth connections.");
    console.error("If Google shows 'access_denied' / app not verified, add your email as a");
    console.error("Test user in Google Cloud Console → OAuth consent screen, then retry.\n");
    process.exit(1);
  }
}

if (!runSync()) {
  console.warn("oauth-bootstrap: attribution sync failed (continuing to verify)");
}

const verified = runVerify(true);
process.exit(verified ? 0 : 1);
