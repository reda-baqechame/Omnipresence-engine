#!/usr/bin/env node
/**
 * Verify production deployment readiness.
 * Usage: node scripts/verify-production.mjs [baseUrl]
 */

const base = process.argv[2] || process.env.SMOKE_BASE_URL || "https://omnipresence-engine.vercel.app";

async function fetchJson(path) {
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

console.log(`\nVerifying ${base}\n`);

try {
  const health = await fetchJson("/api/health");
  const caps = await fetchJson("/api/capabilities");

  console.log(`Version:     ${health.version}`);
  console.log(`Status:      ${health.status}`);
  console.log(`Live data:   ${caps.liveData ? "ON" : "OFF (demo fallback)"}`);
  console.log(`Citation tracking: ${caps.citationTracking ? "ON" : "OFF"}`);
  console.log(`SERP providers: ${caps.serpCapability ? "ON" : "OFF"}`);
  console.log(`DataForSEO fallback: ${caps.dataForSeoFallback ? "ON" : "OFF"}`);
  console.log(`Providers:   ${caps.configuredCount}/${caps.totalProviders} configured\n`);

  const required = caps.providers.filter((p) => p.required && !p.configured);
  const recommended = caps.providers.filter(
    (p) => !p.required && !p.configured && ["serper", "brave", "openai", "perplexity", "inngest", "supabase"].includes(p.id)
  );

  if (required.length) {
    console.log("BLOCKERS (required):");
    for (const p of required) console.log(`  ✗ ${p.name} (${p.id})`);
    console.log("");
  }

  if (recommended.length) {
    console.log("Recommended for real results:");
    for (const p of recommended) console.log(`  ○ ${p.name}`);
    console.log("");
  }

  if (health.checks?.supabase === "skipped") {
    console.log("Next step: Add Supabase env vars on Vercel, run combined.sql migration, redeploy.\n");
  }

  if (!caps.liveData) {
    console.log("Next step: Add SERPER or BRAVE_SEARCH + OPENAI/PERPLEXITY keys for live citation tracking.\n");
  }

  process.exit(required.length ? 1 : 0);
} catch (error) {
  console.error("Verification failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
