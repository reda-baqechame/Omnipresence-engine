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
  console.log(`Intelligence schema: ${health.checks?.intelligence_schema || "unknown"}`);
  console.log(`Phase 8 schema:    ${health.checks?.phase8_schema || "unknown"}`);
  console.log(`Phase 9 schema:    ${health.checks?.phase9_schema || "unknown"}`);
  console.log(`Intelligence API:    ${health.checks?.intelligence_api || "unknown"}`);
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
    console.log("Fix: run npm run prod:setup locally, then redeploy.\n");
  }

  if (health.checks?.intelligence_schema === "error") {
    console.log("Fix: run npm run db:migrate:prod (or npm run db:migrate with DATABASE_URL).\n");
    process.exit(1);
  }

  if (health.checks?.phase8_schema === "error") {
    console.log("Fix: run npm run db:migrate:prod for 0016_phase8.sql (indexing, link orders, community mentions).\n");
    process.exit(1);
  }

  if (health.checks?.phase9_schema === "error") {
    console.log("Fix: run npm run db:migrate:prod for 0017_phase9.sql (visitor_sessions).\n");
    process.exit(1);
  }

  if (production?.warnings?.includes("intelligence_api")) {
    console.log("Tip: DataForSEO, SERPER, or OMNIDATA_BASE_URL powers keyword intelligence.\n");
  }

  process.exitCode = production?.ready === false ? 1 : 0;
} catch (error) {
  console.error("Verification failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
