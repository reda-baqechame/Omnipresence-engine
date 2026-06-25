#!/usr/bin/env node
/**
 * Validate the DIY stack wiring (replaces DataForSEO).
 * Usage: node scripts/wire-diy-stack.mjs [baseUrl]
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] || process.env.SMOKE_BASE_URL || "https://omnipresence-engine.vercel.app";

function loadEnvFile(name) {
  const path = join(root, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function loadEnvLocal() {
  loadEnvFile(".env.local");
  loadEnvFile(".env.production.local");
}

function has(key) {
  const v = process.env[key];
  return Boolean(v && v.length > 0 && !v.startsWith("your-"));
}

loadEnvLocal();

const checks = [
  {
    name: "SERP provider (Serper or Brave)",
    ok: has("SERPER_API_KEY") || has("BRAVE_SEARCH_API_KEY") || (has("DATAFORSEO_LOGIN") && has("DATAFORSEO_PASSWORD")),
    fix: "Set SERPER_API_KEY (cheap) or BRAVE_SEARCH_API_KEY (free tier at brave.com/search/api)",
  },
  {
    name: "Direct LLM visibility",
    ok: has("OPENAI_API_KEY") || has("ANTHROPIC_API_KEY") || has("GOOGLE_GENERATIVE_AI_API_KEY"),
    fix: "Set OPENAI_API_KEY and/or ANTHROPIC_API_KEY and/or GOOGLE_GENERATIVE_AI_API_KEY",
  },
  {
    name: "Perplexity citations (recommended)",
    ok: has("PERPLEXITY_API_KEY"),
    fix: "Set PERPLEXITY_API_KEY for real cited URLs in AI answers",
  },
  {
    name: "Supabase (required)",
    ok: has("NEXT_PUBLIC_SUPABASE_URL") && has("SUPABASE_SERVICE_ROLE_KEY"),
    fix: "Set Supabase env vars and run combined.sql migration",
  },
  {
    name: "Inngest (background scans + Phase 8 crons)",
    ok: has("INNGEST_EVENT_KEY"),
    fix: "Connect Inngest via Vercel marketplace or set INNGEST_EVENT_KEY",
  },
  {
    name: "OmniData engine (recommended)",
    ok: has("OMNIDATA_BASE_URL") && has("OMNIDATA_API_KEY"),
    fix: "Deploy services/omnidata — set OMNIDATA_BASE_URL + API key on Vercel",
  },
  {
    name: "Integration encryption (CMS credentials)",
    ok: has("INTEGRATION_ENCRYPTION_KEY"),
    fix: "Set INTEGRATION_ENCRYPTION_KEY (32+ chars) — npm run prod:keygen",
  },
  {
    name: "IndexNow bulk indexing",
    ok: has("INDEXNOW_KEY"),
    fix: "Set INDEXNOW_KEY for faster URL discovery on Distribution tab",
  },
  {
    name: "Clearbit visitor enrichment (optional)",
    ok: has("CLEARBIT_REVEAL_KEY"),
    fix: "Set CLEARBIT_REVEAL_KEY for company enrichment on Attribution beacon",
  },
];

console.log("\nOmniPresence — DIY Stack Wiring Check\n");

let pass = 0;
for (const c of checks) {
  console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}`);
  if (!c.ok) console.log(`      → ${c.fix}`);
  else pass++;
}

const live =
  (has("OPENAI_API_KEY") || has("ANTHROPIC_API_KEY") || has("GOOGLE_GENERATIVE_AI_API_KEY") || has("PERPLEXITY_API_KEY") || has("SERPER_API_KEY") || has("BRAVE_SEARCH_API_KEY"));

console.log(`\nLocal live mode: ${live ? "READY" : "demo fallback"}`);
console.log(`DataForSEO fallback: ${has("DATAFORSEO_LOGIN") && has("DATAFORSEO_PASSWORD") ? "enabled (optional)" : "off (good — saves ~$100/mo)"}`);

let remoteOk = false;
if (base) {
  try {
    const res = await fetch(`${base}/api/capabilities`, {
      headers: { connection: "close" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const caps = await res.json();
      console.log(`\nRemote (${base}):`);
      console.log(`  Live data: ${caps.liveData ? "ON" : "OFF"}`);
      console.log(`  Citation tracking: ${caps.citationTracking ? "ON" : "OFF"}`);
      console.log(`  Active SERP: ${caps.activeSerpProvider || "none"}`);
      console.log(`  Providers: ${caps.configuredCount}/${caps.totalProviders}`);
      console.log(`  Production ready: ${caps.production?.ready ? "YES" : "NO"} (${caps.production?.score ?? 0}%)`);
      remoteOk = caps.production?.ready === true;
    }
  } catch {
    console.log(`\nRemote check skipped (${base} unreachable)`);
  }
}

console.log("");
// Avoid process.exit() here: on Windows it can race undici's keep-alive
// socket teardown and crash with a libuv UV_HANDLE_CLOSING assertion.
// Setting exitCode lets the event loop drain cleanly instead.
process.exitCode = pass >= 3 || remoteOk ? 0 : 1;
