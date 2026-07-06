#!/usr/bin/env node
/**
 * Phase 9 audit — verify Dominate AEO features exist.
 * Usage: node scripts/audit-phase9.mjs [baseUrl]
 */
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fetchHealth } from "./health-fetch.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] || process.env.SMOKE_BASE_URL || "https://omnipresence-engine.vercel.app";

const REQUIRED_FILES = [
  "src/lib/engines/gsc-queries.ts",
  "src/lib/engines/blog-pipeline.ts",
  "src/lib/engines/nap-checker.ts",
  "src/lib/engines/visitor-identity.ts",
  "src/components/prompt-campaign-panel.tsx",
  "src/components/blog-pipeline-panel.tsx",
  "src/components/llm-referral-chart.tsx",
  "src/components/visitor-identity-panel.tsx",
  "src/components/prompt-heatmap.tsx",
  "src/app/app/projects/[id]/prompts/page.tsx",
  "src/app/api/attribution/referrals/route.ts",
  "src/app/api/visitors/route.ts",
  "src/app/api/podcast/generate/route.ts",
  "supabase/migrations/0017_phase9.sql",
];

let failed = 0;

console.log("\n=== Phase 9 Build Audit ===\n");

console.log("1. File structure");
for (const file of REQUIRED_FILES) {
  const ok = existsSync(join(root, file));
  console.log(`  ${ok ? "✓" : "✗"} ${file}`);
  if (!ok) failed++;
}

console.log("\n2. Blog pipeline (14 steps)");
const pipelineSrc = readFileSync(join(root, "src/lib/engines/blog-pipeline.ts"), "utf8");
if (pipelineSrc.includes("performance_check") && (pipelineSrc.match(/key:/g) || []).length >= 14) {
  console.log("  ✓ 14 pipeline steps defined");
} else {
  console.log("  ✗ pipeline steps incomplete");
  failed++;
}

console.log("\n3. GSC import action");
const promptsSrc = readFileSync(join(root, "src/app/api/prompts/route.ts"), "utf8");
if (promptsSrc.includes("import_gsc") && promptsSrc.includes("batchInsertPrompts")) {
  console.log("  ✓ GSC import + batch insert");
} else {
  console.log("  ✗ GSC import missing");
  failed++;
}

console.log("\n4. Embed v2 params");
const embedSrc = readFileSync(join(root, "src/app/api/embed/audit-snippet/route.ts"), "utf8");
if (embedSrc.includes("brand") && embedSrc.includes("color")) {
  console.log("  ✓ embed snippet supports brand/color");
} else {
  console.log("  ✗ embed v2 missing");
  failed++;
}

console.log("\n5. Visitor sessions migration");
const migSrc = readFileSync(join(root, "supabase/migrations/0017_phase9.sql"), "utf8");
if (migSrc.includes("visitor_sessions") && migSrc.includes("memberships")) {
  console.log("  ✓ visitor_sessions + RLS");
} else {
  console.log("  ✗ migration incomplete");
  failed++;
}

console.log("\n6. Project nav — Prompts");
const osNavSrc = readFileSync(join(root, "src/components/project-os-nav.tsx"), "utf8");
if (osNavSrc.includes("/prompts")) {
  console.log("  ✓ Prompts route wired in project OS nav");
} else {
  console.log("  ✗ Prompts route missing from project OS nav");
  failed++;
}

console.log("\n7. UI wiring");
const whitelabelSrc = readFileSync(join(root, "src/app/app/settings/whitelabel/page.tsx"), "utf8");
const contentSrc = readFileSync(join(root, "src/components/content-board.tsx"), "utf8");
if (whitelabelSrc.includes("/api/embed/audit-snippet")) {
  console.log("  ✓ whitelabel page fetches embed snippet");
} else {
  console.log("  ✗ whitelabel embed not wired");
  failed++;
}
if (contentSrc.includes("/api/podcast/generate")) {
  console.log("  ✓ content board podcast TTS wired");
} else {
  console.log("  ✗ podcast TTS not wired in UI");
  failed++;
}

console.log("\n8. Live API smoke (public)");
try {
  const embedRes = await fetch(`${base}/api/embed/audit-snippet?brand=Test&color=6366f1`);
  const embedOk = embedRes.ok && (await embedRes.text()).includes("embed/audit");
  console.log(`  ${embedOk ? "✓" : "✗"} GET /api/embed/audit-snippet`);
  if (!embedOk) failed++;
} catch {
  console.log("  ✗ embed snippet unreachable");
  failed++;
}

try {
  const podcastRes = await fetch(`${base}/api/podcast/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: "00000000-0000-0000-0000-000000000000", assetId: "00000000-0000-0000-0000-000000000000" }),
    signal: AbortSignal.timeout(15_000),
  });
  const podcastOk = podcastRes.status === 401 || podcastRes.status === 403 || podcastRes.status === 404;
  console.log(`  ${podcastOk ? "✓" : "✗"} POST /api/podcast/generate → ${podcastRes.status}`);
  if (!podcastOk) failed++;
} catch {
  console.log("  ✗ podcast API unreachable");
  failed++;
}

try {
  const { health, mode } = await fetchHealth(base, { timeout: 15_000 });
  console.log("\n9. Production health (phase 9)");
  if (mode === "public") {
    console.log("  ○ detailed checks skipped (set HEALTH_ADMIN_SECRET for operator view)");
  } else {
    const phase9 = health.checks?.phase9_schema;
    const ok = phase9 === "ok" || phase9 === "skipped";
    console.log(`  ${ok ? "✓" : "✗"} phase9_schema: ${phase9 || "unknown"}`);
    if (phase9 === "error") failed++;
    console.log(`  Production ready: ${health.production?.ready ? "YES" : "NO"} (${health.production?.score ?? 0}%)`);
  }
} catch {
  console.log("\n9. Production health skipped");
}

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${failed} issue(s)\n`);
process.exitCode = failed > 0 ? 1 : 0;
