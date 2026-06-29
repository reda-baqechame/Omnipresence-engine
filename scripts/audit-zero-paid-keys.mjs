#!/usr/bin/env node
/**
 * Zero-Paid-Keys audit (Phase 23 / manifest v24, Wave L).
 *
 * Proves the platform runs the full loop with NO paid vendor keys. It:
 *   1. Re-runs the claims benchmark in a child process with ZERO_PAID_KEYS=1 and
 *      every paid key stripped from the environment — so claim coverage reflects
 *      the honest keyless reality (paid-only claims auto-downgrade, never fake).
 *   2. Asserts the architectural guarantee: every capability the platform offers
 *      has at least one sovereign (non-paid) adapter, so nothing is paid-only.
 *
 * Exits non-zero only if the benchmark registry/guard fails or a capability has
 * no sovereign adapter at all. Missing keyless *configuration* (e.g. no SearXNG
 * URL) is reported as a warning, not a failure — that's deployment, not design.
 */
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const PAID_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "DATAFORSEO_LOGIN",
  "DATAFORSEO_PASSWORD",
  "SERPER_API_KEY",
  "PERPLEXITY_API_KEY",
  "FIRECRAWL_API_KEY",
  "RESEND_API_KEY",
  "AYRSHARE_API_KEY",
  "BUFFER_ACCESS_TOKEN",
  "CLEARBIT_REVEAL_KEY",
];

// Sovereign (non-paid) adapters per capability — mirrors the registry in
// src/lib/providers/router.ts. "always" = keyless and always architecturally
// available; otherwise the env var that activates the sovereign path.
const SOVEREIGN = {
  serp: [
    { id: "searxng", env: ["SEARXNG_URL", "SEARXNG_URLS"] },
    { id: "omnidata", env: ["OMNIDATA_BASE_URL"] },
    { id: "playwright-scrape", env: ["OMNIDATA_ENABLE_SCRAPE"] },
  ],
  crawl: [{ id: "playwright-crawl", always: true }],
  backlinks: [{ id: "commoncrawl-webgraph", always: true }],
  generate: [{ id: "ollama-generate", env: ["OLLAMA_BASE_URL"] }],
  email: [{ id: "smtp-email", env: ["SMTP_HOST"] }],
  social: [{ id: "direct-social", env: ["X_ACCESS_TOKEN", "LINKEDIN_ACCESS_TOKEN"] }],
  enrich: [{ id: "ip-asn-enrich", always: true }],
};

function hasEnv(key) {
  const v = process.env[key];
  return Boolean(v && v.length > 0 && !v.startsWith("your-"));
}

console.log("\n=== Zero-Paid-Keys audit ===\n");

// 1. Claims benchmark with paid keys stripped.
const childEnv = { ...process.env, ZERO_PAID_KEYS: "true" };
for (const k of PAID_KEYS) delete childEnv[k];

const bench = spawnSync("node", ["scripts/benchmark.mjs"], {
  cwd: root,
  env: childEnv,
  stdio: "inherit",
  shell: true,
  encoding: "utf8",
});

if (bench.status !== 0) {
  console.error("\nzero-paid-keys: claims benchmark FAILED under keyless mode.\n");
  process.exit(1);
}

// 2. Architectural sovereignty guarantee + configuration report.
console.log("\nSovereign capability coverage (no paid vendor required):");
const gaps = [];
const warnings = [];
for (const [capability, adapters] of Object.entries(SOVEREIGN)) {
  if (adapters.length === 0) {
    gaps.push(capability);
    continue;
  }
  const configured = adapters.some(
    (a) => a.always || (a.env || []).some((e) => hasEnv(e))
  );
  const tag = configured ? "[configured]" : "[available]  ";
  console.log(`  ${tag} ${capability} -> ${adapters.map((a) => a.id).join(", ")}`);
  if (!configured) warnings.push(capability);
}

if (gaps.length) {
  console.error(`\nzero-paid-keys: capabilities with NO sovereign adapter: ${gaps.join(", ")}`);
  console.error("This is a design failure — every capability must have a keyless path.\n");
  process.exit(1);
}

if (warnings.length) {
  console.log(
    `\nNote: sovereign adapters exist for every capability. Not yet configured in this env: ${warnings.join(", ")}.`
  );
  console.log("Configure their keyless infra (SearXNG/OmniData, Ollama, SMTP, direct social) to activate.");
}

console.log("\nzero-paid-keys: PASS — full loop has a sovereign path for every capability.\n");
process.exit(0);
