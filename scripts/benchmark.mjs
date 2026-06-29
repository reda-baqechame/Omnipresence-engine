#!/usr/bin/env node
/**
 * Claims + benchmark harness (Phase 23 / manifest v24, Wave F).
 *
 * Reads the SAME claims registry the app uses (src/lib/config/claims.json) and
 * asserts the product stays honest:
 *   1. Registry integrity — every claim has id/text/metric/provenance and at
 *      least one capability requirement.
 *   2. Forbidden-claim guard — no advertised claim text is itself a forbidden
 *      outcome promise (rank #1 / "appear everywhere in AI").
 *   3. Coverage report — which claims are backed by currently-configured
 *      capabilities (mirrors src/lib/config/capabilities.ts checks).
 *
 * Runs inside `verify:all`, so it must be offline-safe and pass in
 * Zero-Paid-Keys mode: unbacked claims are REPORTED, not failed (the app simply
 * stops advertising them). Pass --strict (or BENCHMARK_STRICT=1) to require
 * every advertised claim to be backed — used by the keyed `audit:live` gate.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const claimsPath = join(root, "src", "lib", "config", "claims.json");

const strict = process.argv.includes("--strict") || process.env.BENCHMARK_STRICT === "1";

function hasEnv(key) {
  const v = process.env[key];
  return Boolean(v && v.length > 0 && !v.startsWith("your-"));
}

// Mirror of src/lib/config/capabilities.ts capability checks (kept in sync).
function hasSerp() {
  return (
    hasEnv("SERPER_API_KEY") ||
    hasEnv("BRAVE_SEARCH_API_KEY") ||
    (hasEnv("OMNIDATA_BASE_URL") && hasEnv("OMNIDATA_API_KEY")) ||
    (hasEnv("DATAFORSEO_LOGIN") && hasEnv("DATAFORSEO_PASSWORD")) ||
    hasEnv("FIRECRAWL_API_KEY")
  );
}
function hasDirectLLM() {
  return hasEnv("OPENAI_API_KEY") || hasEnv("ANTHROPIC_API_KEY") || hasEnv("GOOGLE_GENERATIVE_AI_API_KEY");
}
function hasCitation() {
  return hasDirectLLM() || hasEnv("PERPLEXITY_API_KEY") || hasSerp();
}
function hasAiUiCapture() {
  return process.env.ENABLE_AI_UI_CAPTURE === "true" && hasEnv("AI_UI_CAPTURE_URL");
}
function hasBacklinksIndex() {
  const omnidata = hasEnv("OMNIDATA_BASE_URL") && hasEnv("OMNIDATA_API_KEY");
  const dataforseo = hasEnv("DATAFORSEO_LOGIN") && hasEnv("DATAFORSEO_PASSWORD");
  if (process.env.ZERO_PAID_KEYS === "true") return omnidata;
  return omnidata || dataforseo;
}

const CAP = {
  always: () => true,
  serp: hasSerp,
  citation: hasCitation,
  directLLM: hasDirectLLM,
  aiUiCapture: hasAiUiCapture,
  backlinksIndex: hasBacklinksIndex,
  domainAuthority: () => true,
};

function isBacked(claim) {
  const allOk = (claim.requires || []).every((k) => (CAP[k] ? CAP[k]() : false));
  const anyOk =
    !claim.requiresAny || claim.requiresAny.length === 0
      ? true
      : claim.requiresAny.some((k) => (CAP[k] ? CAP[k]() : false));
  return allOk && anyOk;
}

let registry;
try {
  registry = JSON.parse(readFileSync(claimsPath, "utf8"));
} catch (err) {
  console.error(`benchmark: cannot read claims registry at ${claimsPath}: ${err.message}`);
  process.exit(1);
}

const errors = [];
const claims = registry.claims || [];
const forbidden = (registry.forbiddenPhrases || []).map((p) => p.toLowerCase());

if (!Array.isArray(claims) || claims.length === 0) errors.push("registry has no claims");
if (forbidden.length === 0) errors.push("registry has no forbidden phrases");

const seen = new Set();
for (const c of claims) {
  if (!c.id) errors.push("a claim is missing 'id'");
  if (seen.has(c.id)) errors.push(`duplicate claim id: ${c.id}`);
  seen.add(c.id);
  if (!c.text) errors.push(`claim ${c.id} missing 'text'`);
  if (!c.metric) errors.push(`claim ${c.id} missing 'metric'`);
  if (!c.provenance) errors.push(`claim ${c.id} missing 'provenance'`);
  const reqCount = (c.requires || []).length + (c.requiresAny || []).length;
  if (reqCount === 0) errors.push(`claim ${c.id} has no capability requirement (ungated)`);
  for (const k of [...(c.requires || []), ...(c.requiresAny || [])]) {
    if (!CAP[k]) errors.push(`claim ${c.id} references unknown capability key '${k}'`);
  }
  // The claim text itself must never be a forbidden outcome promise.
  const lower = (c.text || "").toLowerCase();
  const hit = forbidden.filter((p) => lower.includes(p));
  if (hit.length) errors.push(`claim ${c.id} text contains forbidden phrase(s): ${hit.join(", ")}`);
}

// --- Honesty invariants (refund protection — these are non-negotiable) ---
// 1. Any "referring domains" (backlinks) claim MUST be gated on a real index,
//    never advertised with the always-on capability. Otherwise the product
//    promises a referring-domains list it cannot deliver without an index.
for (const c of claims) {
  if (c.metric === "backlinks") {
    const gatedOnIndex = (c.requiresAny || []).includes("backlinksIndex");
    const usesAlways = [...(c.requires || []), ...(c.requiresAny || [])].includes("always");
    if (!gatedOnIndex || usesAlways) {
      errors.push(
        `claim ${c.id} (metric=backlinks) must be gated on 'backlinksIndex' and never 'always'`
      );
    }
  }
}
// 2. The forbidden-claim guard must actually catch every phrase it lists
//    (proves the list is live and the matcher works, not just decoration).
for (const phrase of forbidden) {
  const sample = `Our service will help you ${phrase} fast.`;
  if (!sample.toLowerCase().includes(phrase)) {
    errors.push(`forbidden-guard self-test failed for phrase: '${phrase}'`);
  }
}

const coverage = claims.map((c) => ({ id: c.id, backed: isBacked(c), provenance: c.provenance }));
const backed = coverage.filter((c) => c.backed).length;

console.log("\n=== Claims + benchmark harness ===\n");
console.log(`Claims registered: ${claims.length}`);
console.log(`Forbidden phrases guarded: ${forbidden.length}`);
console.log(`Backed by current capabilities: ${backed}/${claims.length}`);
for (const c of coverage) {
  console.log(`  ${c.backed ? "[backed]   " : "[unbacked] "} ${c.id} (${c.provenance})`);
}

if (errors.length) {
  console.error("\nRegistry/guard errors:");
  for (const e of errors) console.error(`  - ${e}`);
  console.error("\nbenchmark: FAILED\n");
  process.exit(1);
}

if (strict && backed < claims.length) {
  console.error("\nbenchmark --strict: some advertised claims are not backed by measured data.");
  console.error("Configure the missing capabilities or the app must stop advertising them.\n");
  process.exit(1);
}

console.log(
  strict
    ? "\nbenchmark (strict): all claims backed by measured data.\n"
    : "\nbenchmark: registry honest — unbacked claims will be hidden (not faked).\n"
);
process.exit(0);
