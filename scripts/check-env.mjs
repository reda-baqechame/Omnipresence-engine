#!/usr/bin/env node
/**
 * Validate local/production env for OmniPresence Engine v2.
 * Usage: node scripts/check-env.mjs
 * Loads .env.local if present (does not override existing process.env).
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
  return true;
}

function has(key) {
  const v = process.env[key];
  return Boolean(v && v.length > 0 && !v.startsWith("your-"));
}

const GROUPS = [
  {
    title: "Required — app + auth",
    vars: [
      { key: "NEXT_PUBLIC_SUPABASE_URL", required: true },
      { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true },
      { key: "SUPABASE_SERVICE_ROLE_KEY", required: true },
      { key: "OAUTH_STATE_SECRET", required: true },
      { key: "NEXT_PUBLIC_APP_URL", required: true },
    ],
  },
  {
    title: "Live AI citation tracking (DIY stack — no DataForSEO required)",
    vars: [
      { key: "SERPER_API_KEY", required: false },
      { key: "BRAVE_SEARCH_API_KEY", required: false },
      { key: "OPENAI_API_KEY", required: false },
      { key: "ANTHROPIC_API_KEY", required: false },
      { key: "GOOGLE_GENERATIVE_AI_API_KEY", required: false },
      { key: "PERPLEXITY_API_KEY", required: false },
      { key: "DATAFORSEO_LOGIN", required: false },
      { key: "DATAFORSEO_PASSWORD", required: false },
      { key: "FIRECRAWL_API_KEY", required: false },
    ],
  },
  {
    title: "Background jobs + email",
    vars: [
      { key: "INNGEST_EVENT_KEY", required: false },
      { key: "INNGEST_SIGNING_KEY", required: false },
      { key: "RESEND_API_KEY", required: false },
    ],
  },
  {
    title: "Distribution + attribution OAuth",
    vars: [
      { key: "INDEXNOW_KEY", required: false },
      { key: "GOOGLE_CLIENT_ID", required: false },
      { key: "GOOGLE_CLIENT_SECRET", required: false },
      { key: "BING_CLIENT_ID", required: false },
      { key: "BING_CLIENT_SECRET", required: false },
      { key: "AYRSHARE_API_KEY", required: false },
      { key: "BUFFER_ACCESS_TOKEN", required: false },
    ],
  },
];

loadEnvLocal();

let missingRequired = 0;
let optionalMissing = 0;
let optionalSet = 0;

console.log("\nOmniPresence Engine — Environment Check\n");

for (const group of GROUPS) {
  console.log(`## ${group.title}`);
  for (const { key, required } of group.vars) {
    const ok = has(key);
    const icon = ok ? "✓" : required ? "✗" : "○";
    console.log(`  ${icon} ${key}${required && !ok ? " (REQUIRED)" : ""}`);
    if (!ok && required) missingRequired++;
    else if (!ok) optionalMissing++;
    else optionalSet++;
  }
  console.log("");
}

const liveData =
  has("OPENAI_API_KEY") ||
  has("ANTHROPIC_API_KEY") ||
  has("GOOGLE_GENERATIVE_AI_API_KEY") ||
  has("PERPLEXITY_API_KEY") ||
  has("SERPER_API_KEY") ||
  has("BRAVE_SEARCH_API_KEY") ||
  has("DATAFORSEO_LOGIN");
console.log(`Live data mode: ${liveData ? "ENABLED" : "demo fallback"}`);
console.log(`Citation tracking (DIY): ${liveData ? "ENABLED" : "disabled"}`);
console.log(`DataForSEO fallback: ${has("DATAFORSEO_LOGIN") && has("DATAFORSEO_PASSWORD") ? "ENABLED" : "disabled"}\n`);

if (missingRequired > 0) {
  console.log(`Missing ${missingRequired} required variable(s). Copy .env.example → .env.local and fill values.\n`);
  process.exit(1);
}

console.log(`All required vars set. ${optionalSet} optional vars configured.\n`);
process.exit(0);
