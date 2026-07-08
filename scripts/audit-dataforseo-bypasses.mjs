#!/usr/bin/env node
/**
 * DataForSEO / OmniData-compatible client bypass inventory (repo hardening).
 *
 * Patch J enforces DataForSEO fallback-only inside router.ts adapter
 * categories, but ~20+ call sites still import @/lib/providers/dataforseo
 * directly and can bypass rankedAdapters() ordering entirely.
 *
 * This script is a reporting/audit tool — it does NOT fail CI by default.
 * Run: node scripts/audit-dataforseo-bypasses.mjs
 * Writes: docs/audits/dataforseo-bypass-inventory.md
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = join(root, "docs/audits/dataforseo-bypass-inventory.md");

const SCAN_DIRS = ["src", "services"];
const SKIP_DIR_NAMES = new Set(["node_modules", ".next", "dist", "__tests__"]);
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".mjs"]);

const SYMBOL_PATTERNS = [
  { re: /from\s+["']@\/lib\/providers\/dataforseo["']/g, kind: "import" },
  { re: /from\s+["']\.\/dataforseo["']/g, kind: "import" },
  { re: /from\s+["']\.\.\/providers\/dataforseo["']/g, kind: "import" },
  { re: /\blabsApiPost\s*\(/g, symbol: "labsApiPost" },
  { re: /\bdataForSEORequest\s*\(/g, symbol: "dataForSEORequest" },
  { re: /\bgetRealKeywordCpc\s*\(/g, symbol: "getRealKeywordCpc" },
  { re: /\bgetRealKeywordCpcDetailed\s*\(/g, symbol: "getRealKeywordCpcDetailed" },
  { re: /\bgetSerpIntelligence\s*\(/g, symbol: "getSerpIntelligence" },
  { re: /\bsearchGoogleOrganic\s*\(/g, symbol: "searchGoogleOrganic" },
  { re: /\bsearchGoogleAIMode\s*\(/g, symbol: "searchGoogleAIMode" },
  { re: /\bgetBacklinks\s*\(/g, symbol: "getBacklinks" },
  { re: /\bgetBacklinkGraph\s*\(/g, symbol: "getBacklinkGraph" },
  { re: /\bgetLinkIntersection\s*\(/g, symbol: "getLinkIntersection" },
  { re: /\bgetOmniDataAuthority\s*\(/g, symbol: "getOmniDataAuthority" },
  { re: /\bgetLLMMentionsAggregated\s*\(/g, symbol: "getLLMMentionsAggregated" },
  { re: /\bsearchLLMMentions\s*\(/g, symbol: "searchLLMMentions" },
  { re: /\bgetLLMTopDomains\s*\(/g, symbol: "getLLMTopDomains" },
  { re: /\bcheckRankPosition\s*\(/g, symbol: "checkRankPosition" },
  { re: /\bgetMapsPlaces\s*\(/g, symbol: "getMapsPlaces" },
  { re: /\bgetKeywordSuggestionsLive\s*\(/g, symbol: "getKeywordSuggestionsLive" },
  { re: /\bomniDataGet\s*\(/g, symbol: "omniDataGet" },
  { re: /\bisOmniDataActive\s*\(/g, symbol: "isOmniDataActive" },
  { re: /\bhasLabsApi\s*\(/g, symbol: "hasLabsApi" },
];

/** Per-file manual classification overrides (hostile-audit baseline). */
const FILE_META = {
  "src/lib/providers/dataforseo.ts": {
    capability: "client-spine",
    customerFacing: false,
    paidRisk: "internal",
    viaRouter: false,
    provenance: "envelope-at-export",
    budgetGuard: "dataForSEORequest",
    cancellationGuard: false,
    migration: "Keep as low-level client; all callers should route through router or capability-runners",
    priority: "P3",
    note: "Implementation file — not a bypass itself",
  },
  "src/lib/providers/router.ts": {
    capability: "multi",
    customerFacing: true,
    paidRisk: "conditional",
    viaRouter: true,
    provenance: "envelope",
    budgetGuard: "transitive",
    cancellationGuard: false,
    migration: "Canonical SERP/backlinks path — Patch J enforced here",
    priority: "P3",
    note: "Registry enforces fallback_only; rankedAdapters() is the intended gate",
  },
  "src/lib/providers/serp-router.ts": {
    capability: "serp",
    customerFacing: true,
    paidRisk: "low",
    viaRouter: true,
    provenance: "partial",
    budgetGuard: "transitive",
    cancellationGuard: false,
    migration: "Already delegates to router.routeSerp()",
    priority: "P3",
  },
  "src/lib/providers/backlinks-free.ts": {
    capability: "backlinks",
    customerFacing: true,
    paidRisk: "fallback",
    viaRouter: false,
    provenance: "partial",
    budgetGuard: "transitive",
    cancellationGuard: false,
    migration: "Route through capability-runners fetchBacklinks(); demote paid getBacklinks fallback",
    priority: "P1",
  },
  "src/lib/providers/keyword-cpc-cache.ts": {
    capability: "cpc",
    customerFacing: true,
    paidRisk: "conditional",
    viaRouter: false,
    provenance: "cache-label",
    budgetGuard: "transitive + cache",
    cancellationGuard: "report-builder only",
    migration: "Keep cache; ensure all CPC callers use cache + cancellation",
    priority: "P1",
  },
  "src/lib/engines/report-builder.ts": {
    capability: "cpc",
    customerFacing: true,
    paidRisk: "conditional",
    viaRouter: false,
    provenance: "ads-equivalent cpcSource",
    budgetGuard: "transitive",
    cancellationGuard: true,
    migration: "Patch C.1 complete for report path",
    priority: "P3",
  },
  "src/lib/engines/ppc-intelligence.ts": {
    capability: "cpc+serp",
    customerFacing: true,
    paidRisk: "high",
    viaRouter: false,
    provenance: "partial",
    budgetGuard: "transitive",
    cancellationGuard: false,
    migration: "Use getCachedRealKeywordCpc + router SERP; add cancellation",
    priority: "P0",
  },
  "src/lib/engines/backlink-monitor.ts": {
    capability: "backlinks",
    customerFacing: true,
    paidRisk: "high",
    viaRouter: false,
    provenance: "partial",
    budgetGuard: "transitive",
    cancellationGuard: false,
    migration: "Use fetchBacklinks() capability-runner; paid getBacklinks benchmark-only",
    priority: "P0",
  },
  "src/lib/engines/authority-finder.ts": {
    capability: "backlinks",
    customerFacing: true,
    paidRisk: "high",
    viaRouter: false,
    provenance: "partial",
    budgetGuard: "transitive",
    cancellationGuard: false,
    migration: "Remove direct getBacklinks paid fallback; sovereign-first",
    priority: "P0",
  },
  "src/app/api/serp-explorer/route.ts": {
    capability: "serp",
    customerFacing: true,
    paidRisk: "high",
    viaRouter: false,
    provenance: "no",
    budgetGuard: "transitive",
    cancellationGuard: false,
    migration: "Replace getSerpIntelligence with searchGoogleOrganicRouter",
    priority: "P0",
  },
  "src/lib/engines/provider-benchmark.ts": {
    capability: "benchmark",
    customerFacing: false,
    paidRisk: "intentional",
    viaRouter: "partial",
    provenance: "benchmark",
    budgetGuard: "transitive",
    cancellationGuard: false,
    migration: "Keep paid side for benchmark; tag benchmark_only spend",
    priority: "P2",
  },
  "src/lib/engines/citation-intelligence.ts": {
    capability: "llm-mentions",
    customerFacing: true,
    paidRisk: "high",
    viaRouter: false,
    provenance: "partial",
    budgetGuard: "transitive",
    cancellationGuard: false,
    migration: "LLM mentions intentionally DataForSEO-primary per plan; document + gate",
    priority: "P1",
  },
  "src/lib/engines/visibility-scanner.ts": {
    capability: "llm-mentions",
    customerFacing: true,
    paidRisk: "conditional",
    viaRouter: "partial",
    provenance: "yes",
    budgetGuard: "tenant + external",
    cancellationGuard: "scan cancel",
    migration: "SERP via router OK; searchLLMMentions direct — plan exception",
    priority: "P1",
  },
};

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if (SCAN_EXT.has(p.slice(p.lastIndexOf(".")))) files.push(p);
  }
  return files;
}

function inferMeta(relPath, symbols) {
  if (FILE_META[relPath]) return { ...FILE_META[relPath], symbols };

  const isRoute = relPath.includes("/app/api/") && relPath.endsWith("route.ts");
  const isTest = relPath.includes("__tests__") || relPath.includes("/tests/");
  const isProvider = relPath.startsWith("src/lib/providers/");
  const isInngest = relPath.includes("inngest/");

  let capability = "unknown";
  if (symbols.some((s) => ["getBacklinks", "getBacklinkGraph", "getLinkIntersection"].includes(s))) capability = "backlinks";
  else if (symbols.some((s) => ["getRealKeywordCpc", "getRealKeywordCpcDetailed"].includes(s))) capability = "cpc";
  else if (symbols.some((s) => ["searchGoogleOrganic", "getSerpIntelligence", "searchGoogleAIMode", "checkRankPosition"].includes(s))) capability = "serp";
  else if (symbols.some((s) => ["getLLMMentionsAggregated", "searchLLMMentions", "getLLMTopDomains"].includes(s))) capability = "llm-mentions";
  else if (symbols.some((s) => ["labsApiPost", "omniDataGet"].includes(s))) capability = "labs";
  else if (symbols.some((s) => ["getOmniDataAuthority"].includes(s))) capability = "authority";
  else if (symbols.some((s) => ["getMapsPlaces"].includes(s))) capability = "local";
  else if (symbols.some((s) => ["isOmniDataActive", "hasLabsApi"].includes(s))) capability = "config-only";

  const viaRouter =
    relPath.includes("serp-router") ||
    relPath.includes("router.ts") ||
    symbols.every((s) => ["isOmniDataActive", "hasLabsApi"].includes(s));

  return {
    capability,
    customerFacing: isRoute || (!isTest && !isInngest && relPath.startsWith("src/lib/engines/")),
    paidRisk: isTest ? "none" : viaRouter ? "low" : "medium",
    viaRouter,
    provenance: isRoute ? "unknown" : "partial",
    budgetGuard: symbols.includes("labsApiPost") || symbols.includes("dataForSEORequest") ? "transitive" : symbols.length ? "transitive" : "n/a",
    cancellationGuard: false,
    migration: viaRouter
      ? "Already router-backed or config-only"
      : "Migrate to router.ts / capability-runners / PresenceData envelope",
    priority: isTest ? "P3" : isRoute ? "P0" : isProvider ? "P1" : "P2",
    symbols,
    note: isTest ? "Test/mock reference — not a production bypass" : undefined,
  };
}

function scanFile(absPath) {
  const relPath = relative(root, absPath).replace(/\\/g, "/");
  const text = readFileSync(absPath, "utf8");
  const symbols = new Set();
  let importsDataforseo = false;

  for (const { re, kind, symbol } of SYMBOL_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) {
      if (kind === "import") importsDataforseo = true;
      else if (symbol) symbols.add(symbol);
    }
  }

  if (!importsDataforseo && symbols.size === 0) return null;
  if (relPath === "scripts/audit-dataforseo-bypasses.mjs") return null;

  const symList = [...symbols].sort();
  const meta = inferMeta(relPath, symList);
  return { file: relPath, importsDataforseo, ...meta };
}

function priorityRank(p) {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[p] ?? 9;
}

function renderMarkdown(rows, generatedAt) {
  const directBypass = rows.filter((r) => !r.viaRouter && r.file !== "src/lib/providers/dataforseo.ts");
  const routerBacked = rows.filter((r) => r.viaRouter);
  const p0 = directBypass.filter((r) => r.priority === "P0");

  const lines = [
    "# DataForSEO direct-bypass inventory",
    "",
    `> Auto-generated by \`scripts/audit-dataforseo-bypasses.mjs\`. Regenerate: \`node scripts/audit-dataforseo-bypasses.mjs\``,
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Executive summary",
    "",
    "**Patch J enforces DataForSEO fallback-only inside `router.ts`, but direct imports of `dataforseo.ts` can still bypass that registry.**",
    "",
    "The shared client (`src/lib/providers/dataforseo.ts`) funnels paid OmniData/DataForSEO-compatible",
    "calls through `dataForSEORequest()` which applies `assertWithinExternalApiBudget()`. That is cost",
    "guarding, not routing: callers that import `getBacklinks()`, `labsApiPost()`, `getSerpIntelligence()`,",
    "etc. directly never pass through `rankedAdapters()` and therefore never honor Patch J's",
    "`fallback_only` category ordering.",
    "",
    `- **Total files with dataforseo spine touchpoints:** ${rows.length}`,
    `- **Direct bypass candidates (not router-backed):** ${directBypass.length}`,
    `- **Router-backed or config-only:** ${routerBacked.length}`,
    `- **P0 migration priority:** ${p0.length}`,
    "",
    "## Full inventory",
    "",
    "| File | Capability | Customer-facing | Paid risk | Via router | Provenance | Budget guard | Cancel guard | Priority | Migration |",
    "|------|------------|-----------------|-----------|------------|------------|--------------|--------------|----------|-------------|",
  ];

  for (const r of [...rows].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.file.localeCompare(b.file))) {
    const syms = (r.symbols || []).join(", ") || (r.importsDataforseo ? "import" : "—");
    lines.push(
      `| \`${r.file}\` | ${r.capability} | ${r.customerFacing} | ${r.paidRisk} | ${r.viaRouter} | ${r.provenance} | ${r.budgetGuard} | ${r.cancellationGuard} | ${r.priority} | ${r.migration} |`
    );
    if (r.note) lines.push(`| ↳ _${r.note}_ | | | | | | | | | |`);
    if (syms && syms !== "import") lines.push(`| ↳ symbols: \`${syms}\` | | | | | | | | | |`);
  }

  lines.push(
    "",
    "## P0 direct bypasses (migrate first)",
    "",
    ...p0.map((r) => `- \`${r.file}\` — ${r.migration}`),
    "",
    "## What Patch J actually enforces",
    "",
    "- Static CI regex in `scripts/verify-output-quality.mjs` — paid `dataforseo*` adapters in `router.ts` must stay `fallback_only`/`benchmark_only`.",
    "- Runtime `auditDataForSeoCategories()` on `/api/admin/benchmark-runs` — same invariant on live registry.",
    "- **Does NOT enforce:** direct `import { getBacklinks } from '@/lib/providers/dataforseo'` in engines/routes.",
    "",
    "## Recommended migration order",
    "",
    "1. **P0** — Customer-facing routes and engines with direct paid calls (`serp-explorer`, `ppc-intelligence`, `backlink-monitor`, `authority-finder`).",
    "2. **P1** — `backlinks-free` paid fallback, citation/visibility LLM-mentions paths (document plan exception).",
    "3. **P2** — Benchmark/intelligence-api/embeddings/webgraph labs paths (keep benchmark spend tagged).",
    "4. **P3** — Config-only `isOmniDataActive()` imports, router internals, tests.",
    ""
  );

  return lines.join("\n");
}

const files = SCAN_DIRS.flatMap((d) => {
  const abs = join(root, d);
  try {
    return walk(abs);
  } catch {
    return [];
  }
});

const rows = files.map(scanFile).filter(Boolean);
const generatedAt = new Date().toISOString();
const md = renderMarkdown(rows, generatedAt);
writeFileSync(OUT_PATH, md, "utf8");

const directCount = rows.filter((r) => !r.viaRouter && r.file !== "src/lib/providers/dataforseo.ts").length;
const p0Count = rows.filter((r) => r.priority === "P0").length;

console.log("PASS — dataforseo bypass audit (non-blocking)");
console.log(`  files scanned: ${files.length}`);
console.log(`  touchpoints: ${rows.length}`);
console.log(`  direct bypass candidates: ${directCount}`);
console.log(`  P0 priority: ${p0Count}`);
console.log(`  wrote: ${relative(root, OUT_PATH)}`);

process.exit(0);
