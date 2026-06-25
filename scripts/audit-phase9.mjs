#!/usr/bin/env node
/**
 * Phase 9 audit — verify Dominate AEO features exist.
 * Usage: node scripts/audit-phase9.mjs [baseUrl]
 */
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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

console.log("\n6. Project tabs — Prompts");
const tabsSrc = readFileSync(join(root, "src/components/project-tabs.tsx"), "utf8");
if (tabsSrc.includes("/prompts")) {
  console.log("  ✓ Prompts tab wired");
} else {
  console.log("  ✗ Prompts tab missing");
  failed++;
}

console.log("\n7. Live API smoke (public)");
try {
  const embedRes = await fetch(`${base}/api/embed/audit-snippet?brand=Test&color=6366f1`);
  const embedOk = embedRes.ok && (await embedRes.text()).includes("embed/audit");
  console.log(`  ${embedOk ? "✓" : "✗"} GET /api/embed/audit-snippet`);
  if (!embedOk) failed++;
} catch {
  console.log("  ✗ embed snippet unreachable");
  failed++;
}

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${failed} issue(s)\n`);
process.exit(failed > 0 ? 1 : 0);
