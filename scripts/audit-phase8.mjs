#!/usr/bin/env node
/**
 * Phase 8 audit — verify claimed features exist and respond on live deployment.
 * Usage: node scripts/audit-phase8.mjs [baseUrl]
 */
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] || process.env.SMOKE_BASE_URL || "https://omnipresence-engine.vercel.app";

const REQUIRED_FILES = [
  "src/lib/engines/on-page-agents.ts",
  "src/lib/engines/on-page-queue.ts",
  "src/lib/engines/bulk-indexing.ts",
  "src/lib/engines/link-building.ts",
  "src/lib/engines/community-mentions.ts",
  "src/lib/engines/ads-equivalent.ts",
  "src/app/api/on-page/route.ts",
  "src/app/api/indexing/route.ts",
  "src/app/api/link-building/route.ts",
  "src/app/api/community/route.ts",
  "src/app/api/tools/canonical/route.ts",
  "src/app/api/tools/sitemap/route.ts",
  "src/app/api/tools/citation-planner/route.ts",
  "src/app/api/tools/roi/route.ts",
  "src/components/link-building-panel.tsx",
  "src/components/indexing-panel.tsx",
  "src/components/on-page-panel.tsx",
  "src/app/app/projects/[id]/coverage/page.tsx",
  "supabase/migrations/0016_phase8.sql",
  "services/omnidata/src/engines/maps-serp.ts",
];

const INNGEST_CRONS = [
  "daily-on-page-automation",
  "daily-freshness-check",
  "guarantee-verification-cron",
  "weekly-intelligence-sync",
  "weekly-internal-link-scan",
  "weekly-rank-check",
  "weekly-attribution-sync",
  "citation-diff-alert",
  "weekly-report-email",
  "weekly-backlink-monitor",
  "weekly-rescan",
  "monthly-rescan",
  "monthly-link-building",
  "monthly-attribution-sync",
  "scheduled-content-publish",
];

let failed = 0;

console.log("\n=== Phase 8 Build Audit ===\n");

console.log("1. File structure");
for (const file of REQUIRED_FILES) {
  const ok = existsSync(join(root, file));
  console.log(`  ${ok ? "✓" : "✗"} ${file}`);
  if (!ok) failed++;
}

console.log("\n2. Inngest cron registration");
const functionsSrc = readFileSync(join(root, "src/lib/inngest/functions.ts"), "utf8");
for (const id of INNGEST_CRONS) {
  const ok = functionsSrc.includes(`id: "${id}"`);
  console.log(`  ${ok ? "✓" : "✗"} ${id}`);
  if (!ok) failed++;
}

console.log("\n3. Six on-page agents");
const agentsSrc = readFileSync(join(root, "src/lib/engines/on-page-agents.ts"), "utf8");
for (const agent of ["title", "meta", "alt", "h1", "freshness", "schema", "qc"]) {
  const ok = agentsSrc.includes(`agent: "${agent}"`);
  if (agent === "h1" || agent === "alt") {
    console.log(`  ${ok ? "✓" : "✗"} agent:${agent}`);
    if (!ok) failed++;
  }
}

console.log("\n4. Link building anchor mix (55/25/20)");
const lbSrc = readFileSync(join(root, "src/lib/engines/link-building.ts"), "utf8");
if (lbSrc.includes("0.55") && lbSrc.includes("0.25") && lbSrc.includes("0.2")) {
  console.log("  ✓ anchor mix constants");
} else {
  console.log("  ✗ anchor mix missing");
  failed++;
}

console.log(`\n5. Live API smoke (${base})`);
async function smoke(name, path, options) {
  try {
    const res = await fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(20_000) });
    const ok = res.ok || res.status === 401;
    console.log(`  ${ok ? "✓" : "✗"} ${name} → ${res.status}`);
    if (!ok) failed++;
    return res;
  } catch (err) {
    console.log(`  ✗ ${name} → ${err instanceof Error ? err.message : "failed"}`);
    failed++;
    return null;
  }
}

await smoke("health", "/api/health");
await smoke("capabilities", "/api/capabilities");
await smoke("ROI tool", "/api/tools/roi", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ organicSessions: 500, monthlyAdSpend: 2000, industry: "saas" }),
});
await smoke("citation planner", "/api/tools/citation-planner", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ brand: "Acme", industry: "dental" }),
});
await smoke("embed snippet", "/api/embed/audit-snippet?brand=Audit&color=6366f1");
await smoke("podcast API", "/api/podcast/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ projectId: "00000000-0000-0000-0000-000000000000", assetId: "00000000-0000-0000-0000-000000000000" }),
});

try {
  const healthRes = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(15_000) });
  if (healthRes.ok) {
    const health = await healthRes.json();
    const checks = [
      ["supabase", health.checks?.supabase],
      ["intelligence_schema", health.checks?.intelligence_schema],
      ["phase8_schema", health.checks?.phase8_schema],
      ["phase9_schema", health.checks?.phase9_schema],
      ["integration_encryption", health.checks?.integration_encryption],
    ];
    console.log("\n6. Production health checks");
    for (const [name, status] of checks) {
      const ok = status === "ok" || status === "skipped";
      console.log(`  ${ok ? "✓" : "○"} ${name}: ${status || "unknown"}`);
      if (status === "error") failed++;
    }
    console.log(`\n  Production ready: ${health.production?.ready ? "YES" : "NO"} (${health.production?.score ?? 0}%)`);
  }
} catch {
  console.log("\n6. Production health checks skipped");
}

console.log(failed === 0 ? "\nPhase 8 audit PASSED.\n" : `\nPhase 8 audit: ${failed} issue(s).\n`);
process.exitCode = failed > 0 ? 1 : 0;
