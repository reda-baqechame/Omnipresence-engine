#!/usr/bin/env node
/**
 * Verify live/public endpoints return measured (not demo) data when keys exist.
 * Usage: node scripts/audit-live-results.mjs [baseUrl]
 */
const base = process.argv[2] || process.env.SMOKE_BASE_URL || "https://omnipresence-engine.vercel.app";

let failed = 0;

console.log("\n=== Live Results Audit ===\n");

try {
  const caps = await fetch(`${base}/api/capabilities`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json());
  console.log(`Live data: ${caps.liveData ? "ON" : "OFF"}`);
  console.log(`Citation tracking: ${caps.citationTracking ? "ON" : "OFF"}`);
  console.log(`SERP: ${caps.activeSerpProvider || "none"}`);
  if (!caps.liveData) {
    console.log("  ✗ Production should have live data ON");
    failed++;
  } else {
    console.log("  ✓ Live data enabled");
  }
} catch (e) {
  console.log("  ✗ capabilities unreachable", e instanceof Error ? e.message : "");
  failed++;
}

try {
  const audit = await fetch(`${base}/api/public/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      domain: "stripe.com",
      brandName: "Stripe",
      industry: "payments",
      email: "audit-test@example.com",
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!audit.ok) {
    console.log(`  ✗ public audit → ${audit.status}`);
    failed++;
  } else {
    const data = await audit.json();
    const measured = data.dataMode === "measured" || data.intelligence?.dataMode === "measured";
    console.log(`  ${measured ? "✓" : "✗"} public audit dataMode: ${data.dataMode || data.intelligence?.dataMode || "unknown"}`);
    if (!measured) failed++;
    if (data.score?.omnipresence > 0) {
      console.log(`  ✓ omnipresence score: ${data.score.omnipresence}`);
    }
  }
} catch (e) {
  console.log("  ✗ public audit failed", e instanceof Error ? e.message : "");
  failed++;
}

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${failed} issue(s)\n`);
process.exit(failed > 0 ? 1 : 0);
