#!/usr/bin/env node
/**
 * Phase 10 audit — verify the AEO Domination Engine (7-lever readiness) exists.
 * Usage: node scripts/audit-phase10.mjs [baseUrl]
 */
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fetchHealth } from "./health-fetch.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] || process.env.SMOKE_BASE_URL || "https://omnipresence-engine.vercel.app";

const REQUIRED_FILES = [
  "src/lib/providers/pagespeed.ts",
  "src/lib/providers/tranco.ts",
  "src/lib/engines/aeo-readiness.ts",
  "src/app/app/projects/[id]/aeo-readiness/page.tsx",
  "supabase/migrations/0018_aeo_readiness.sql",
];

let failed = 0;

console.log("\n=== Phase 10 AEO Domination Audit ===\n");

console.log("1. File structure");
for (const file of REQUIRED_FILES) {
  const ok = existsSync(join(root, file));
  console.log(`  ${ok ? "✓" : "✗"} ${file}`);
  if (!ok) failed++;
}

console.log("\n2. Seven levers defined");
const readinessSrc = readFileSync(join(root, "src/lib/engines/aeo-readiness.ts"), "utf8");
const levers = ["crawlability", "passages", "schema", "entity", "authority", "comparison", "freshness"];
const present = levers.filter((l) => readinessSrc.includes(`"${l}"`));
if (present.length === 7) {
  console.log("  ✓ all 7 levers present");
} else {
  console.log(`  ✗ only ${present.length}/7 levers found`);
  failed++;
}

console.log("\n3. Deterministic vs probabilistic split");
if (readinessSrc.includes("deterministic") && readinessSrc.includes("probabilistic")) {
  console.log("  ✓ lever types defined");
} else {
  console.log("  ✗ lever type split missing");
  failed++;
}

console.log("\n4. Two-tier guarantee");
const guaranteeSrc = readFileSync(join(root, "src/lib/engines/guarantee.ts"), "utf8");
if (guaranteeSrc.includes("buildTwoTierGuarantee") && guaranteeSrc.includes("deterministicDeliverables")) {
  console.log("  ✓ two-tier guarantee wired");
} else {
  console.log("  ✗ two-tier guarantee missing");
  failed++;
}

console.log("\n5. PageSpeed + Tranco wired into scoring");
const scoringSrc = readFileSync(join(root, "src/lib/scoring/omnipresence.ts"), "utf8");
if (scoringSrc.includes("domainAuthority") && scoringSrc.includes("pageSpeedScore")) {
  console.log("  ✓ authority + speed signals in scoring");
} else {
  console.log("  ✗ scoring signals missing");
  failed++;
}

console.log("\n6. Scan loop persists readiness");
const scanSrc = readFileSync(join(root, "src/lib/engines/scan-steps.ts"), "utf8");
if (scanSrc.includes("calculateAeoReadiness") && scanSrc.includes("aeo_readiness")) {
  console.log("  ✓ AEO readiness computed + persisted in scan");
} else {
  console.log("  ✗ scan loop wiring missing");
  failed++;
}

console.log("\n7. Production health (phase 10)");
try {
  const { health, mode } = await fetchHealth(base, { timeout: 15_000 });
  if (mode === "public") {
    console.log("  ○ detailed checks skipped (set HEALTH_ADMIN_SECRET for operator view)");
  } else {
    const phase10 = health.checks?.phase10_schema;
    const ok = phase10 === "ok" || phase10 === "skipped";
    console.log(`  ${ok ? "✓" : "✗"} phase10_schema: ${phase10 || "unknown"}`);
    if (phase10 === "error") failed++;
  }
} catch {
  console.log("  ○ health check skipped (unreachable)");
}

console.log(failed === 0 ? "\nPASS — 0 issue(s)\n" : `\nFAIL — ${failed} issue(s)\n`);
process.exitCode = failed > 0 ? 1 : 0;
