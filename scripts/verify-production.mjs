#!/usr/bin/env node
/**
 * Verify production deployment readiness.
 * Usage: node scripts/verify-production.mjs [baseUrl]
 *
 * Public /api/health returns only `{ ok: true }`. Set HEALTH_ADMIN_SECRET (bearer)
 * for schema, provider, and production-readiness checks.
 */
import { fetchHealth } from "./health-fetch.mjs";

const base = process.argv[2] || process.env.SMOKE_BASE_URL || "https://omnipresence-engine.vercel.app";

console.log(`\nVerifying ${base}\n`);

try {
  const { health, mode } = await fetchHealth(base);

  if (mode === "public") {
    const healthy = health.ok === true || health.status === "healthy";
    console.log(`Public health: ${healthy ? "OK" : "DEGRADED"} (${health.status || "unknown"})`);
    if (!healthy) {
      process.exit(1);
    }
    if (!process.env.HEALTH_ADMIN_SECRET?.trim()) {
      console.log(
        "\nDetailed checks skipped — set HEALTH_ADMIN_SECRET (Vercel + local) for schema/provider audit."
      );
      console.log("  Generate: openssl rand -hex 32");
      console.log("  Or run: node scripts/ensure-prod-env.mjs\n");
      process.exit(0);
    }
    console.log(
      "\nHEALTH_ADMIN_SECRET is set locally but /api/health returned the public payload."
    );
    console.log("  Ensure the same secret is configured on Vercel production, then retry.\n");
    process.exit(1);
  }

  // Optional: authenticated operator view (401 without session is expected).
  let caps = null;
  try {
    const res = await fetch(`${base}/api/capabilities`, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) caps = await res.json();
  } catch {
    /* health is the source of truth for operator prod checks */
  }

  const liveData = health.checks?.live_data === "ok" || Boolean(caps?.liveData);
  const citationTracking =
    health.checks?.citation_tracking === "ok" || Boolean(caps?.citationTracking);
  const serpOn = health.checks?.serp === "ok" || Boolean(caps?.serpCapability);
  const production = health.production || caps?.production;

  console.log(`Version:     ${health.version}`);
  console.log(`Status:      ${health.status}`);
  console.log(`Prod ready:  ${production?.ready ? "YES" : "NO"} (score ${production?.score ?? 0}%)`);
  console.log(`Live data:   ${liveData ? "ON" : "OFF (demo fallback)"}`);
  console.log(`Citation tracking: ${citationTracking ? "ON" : "OFF"}`);
  console.log(`SERP providers: ${serpOn ? "ON" : "OFF"}`);
  console.log(`OmniData:    ${health.checks?.omnidata || "not configured"}`);
  if (health.googleCloud) {
    const g = health.googleCloud;
    const on = (v) => (v ? "ON" : "OFF");
    console.log(`Google Cloud key: ${g.keyConfigured ? "SET" : "missing"}`);
    console.log(
      `  PageSpeed/CrUX: ${on(g.pagespeed)} · History: ${on(g.cruxHistory)} · YouTube: ${on(g.youtube)} · KG: ${on(g.knowledgeGraph)} · NLP: ${on(g.naturalLanguage)}`
    );
  }
  console.log(`Integration encryption: ${health.checks?.integration_encryption || "unknown"}`);
  console.log(`Intelligence schema: ${health.checks?.intelligence_schema || "unknown"}`);
  console.log(`Phase 8 schema:    ${health.checks?.phase8_schema || "unknown"}`);
  console.log(`Phase 9 schema:    ${health.checks?.phase9_schema || "unknown"}`);
  console.log(`Phase 10 schema:   ${health.checks?.phase10_schema || "unknown"}`);
  console.log(`Intelligence API:    ${health.checks?.intelligence_api || "unknown"}`);
  console.log(
    `Providers:   ${health.providersConfigured ?? caps?.configuredCount ?? "?"}/${caps?.totalProviders ?? "?"} configured\n`
  );

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

  if (caps?.providers) {
    const required = caps.providers.filter((p) => p.required && !p.configured);
    if (required.length) {
      console.log("Missing required providers:");
      for (const p of required) console.log(`  ✗ ${p.name} (${p.id})`);
      console.log("");
    }
  }

  if (health.checks?.supabase === "skipped") {
    console.log("Next step: Add Supabase env vars on Vercel, run npm run db:migrate, redeploy.\n");
  }

  if (!liveData) {
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

  if (health.checks?.phase10_schema === "error") {
    console.log("Fix: run npm run db:migrate:prod for 0018_aeo_readiness.sql (aeo_readiness).\n");
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
