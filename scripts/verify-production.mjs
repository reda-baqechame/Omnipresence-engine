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
  console.log(`Prod ready:  ${health.production?.ready ? "YES" : "NO"} (score ${health.production?.score ?? 0}%)`);
  console.log(`Live data:   ${caps.liveData ? "ON" : "OFF (demo fallback)"}`);
  console.log(`Citation tracking: ${caps.citationTracking ? "ON" : "OFF"}`);
  console.log(`SERP providers: ${caps.serpCapability ? "ON" : "OFF"}`);
  console.log(`OmniData:    ${health.checks?.omnidata || "not configured"}`);
  console.log(`Integration encryption: ${health.checks?.integration_encryption || "unknown"}`);
  console.log(`Providers:   ${caps.configuredCount}/${caps.totalProviders} configured\n`);

  const production = health.production || caps.production;
  const checkList = production?.checks || [];
  if (production?.blockers?.length) {
    console.log("BLOCKERS:");
    for (const id of production.blockers) {
      const check = checkList.find((c) => c.id === id);
      console.log(`  ✗ ${check?.label || id}: ${check?.message || ""}`);
    }
    console.log("");
  }

  if (production?.warnings?.length) {
    console.log("Warnings:");
    for (const id of production.warnings) {
      const check = checkList.find((c) => c.id === id);
      console.log(`  ○ ${check?.label || id}: ${check?.message || ""}`);
    }
    console.log("");
  }

  const required = caps.providers.filter((p) => p.required && !p.configured);
  if (required.length) {
    console.log("Missing required providers:");
    for (const p of required) console.log(`  ✗ ${p.name} (${p.id})`);
    console.log("");
  }

  if (health.checks?.supabase === "skipped") {
    console.log("Next step: Add Supabase env vars on Vercel, run npm run db:migrate, redeploy.\n");
  }

  if (!caps.liveData) {
    console.log("Next step: Add SERPER or OMNIDATA + OPENAI/PERPLEXITY keys for live citation tracking.\n");
  }

  if (production?.blockers?.includes("integration_encryption")) {
    console.log("Fix: run npm run prod:keygen locally, then add INTEGRATION_ENCRYPTION_KEY on Vercel and redeploy.\n");
  }

  process.exit(production?.ready === false ? 1 : 0);
} catch (error) {
  console.error("Verification failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
