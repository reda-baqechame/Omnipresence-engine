#!/usr/bin/env node
/**
 * Output-quality gate: protects users from fake/generic product output.
 *
 * This is intentionally static and fast so it can run in CI. Runtime tests still
 * verify plumbing; this gate verifies that customer-facing scans cannot regress
 * into demo data, generic roadmaps, or scattered navigation.
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const scanRunner = read("src/lib/engines/scan-runner.ts");
const scanSteps = read("src/lib/engines/scan-steps.ts");
const tabs = read("src/components/project-tabs.tsx");
const promptGenerator = read("src/lib/engines/prompt-generator.ts");
const roadmap = read("src/lib/engines/roadmap-generator.ts");
const provenanceBadge = read("src/components/provenance-badge.tsx");
const visibilityTable = read("src/components/visibility-table.tsx");

assert(!/generateDemo|resolveScanDemoMode/.test(scanRunner), "scan-runner must not import/call demo data generators");
assert(!/generateDemo|resolveScanDemoMode/.test(scanSteps), "scan-steps must not import/call demo data generators");
// Phase 0 trust cleanup (Master Plan v4): the demo shim was deleted outright —
// it must never come back.
assert(!existsSync(join(root, "src/lib/demo/scan-data.ts")), "src/lib/demo/scan-data.ts must stay deleted (demo shim removed in Phase 0)");
assert(!existsSync(join(root, "docs/case-studies")), "docs/case-studies must stay deleted (fabricated case studies removed in Phase 0)");

const tabCount = [...tabs.matchAll(/\{\s*href:/g)].length;
assert(tabCount <= 7, `project navigation must expose <= 7 workflow hubs, found ${tabCount}`);
assert(!/War Room.*Proof Ledger.*GEO Lift/s.test(tabs), "project tabs must not be a flat jargon wall");

assert(/generateSerpResearchedPrompts/.test(promptGenerator), "prompt generator must use SERP-researched prompts");
assert(!/Fallback: template-based generation/.test(promptGenerator), "scan prompt generation must not silently fall back to generic templates");

assert(!/generateStructured/.test(roadmap), "roadmap must not be generic LLM-generated");
assert(/source_type/.test(roadmap) && /evidence_label/.test(roadmap), "roadmap items must carry evidence/source metadata");

assert(/provider\?/.test(provenanceBadge) && /evidenceUrl\?/.test(provenanceBadge), "ProvenanceBadge must expose provider and evidence URL");
assert(/raw_response/.test(visibilityTable) && /evidenceUrl/.test(visibilityTable), "visibility rows must surface provider/evidence metadata");

const runners = read("src/lib/providers/capability-runners.ts");
const router = read("src/lib/providers/router.ts");
assert(
  /fetch-crawl/.test(router) && /fetch-crawl/.test(runners),
  "crawl sovereign adapter id must be fetch-crawl (keyless HTTP fetch, not playwright)"
);
assert(
  !/playwright-crawl/.test(router) && !/playwright-crawl/.test(runners),
  "misleading playwright-crawl adapter id must not remain in router/runners"
);

// Patch F (no-evidence/no-claim report quality gate): the deep-report LLM
// executive summary must always pass through the SAME forbidden-claims and
// content-defect guards generate-router.ts already applies to sovereign
// content generation before it is allowed to ship in a paid report. This
// pins the import + call sites so a future refactor can't silently drop the
// guard and let a raw, unvetted Gemini response back to a client.
const narrative = read("src/lib/engines/intelligence-report-narrative.ts");
assert(
  /from\s+["']@\/lib\/config\/claims["']/.test(narrative) && /findForbiddenClaims\(/.test(narrative),
  "intelligence-report-narrative.ts must import and call findForbiddenClaims on LLM output"
);
assert(
  /from\s+["']@\/lib\/engines\/content-defects["']/.test(narrative) && /detectContentDefects\(/.test(narrative),
  "intelligence-report-narrative.ts must import and call detectContentDefects on LLM output"
);
assert(
  /return fallback;/.test(narrative),
  "intelligence-report-narrative.ts must fall back to the deterministic narrative when the quality gate rejects LLM output"
);

// Patch J (DataForSEO fallback-only enforcement gate): a paid, DataForSEO-
// sourced adapter must never be registered as anything other than
// fallback_only/benchmark_only in router.ts. Per the PresenceData OS plan,
// promoting one to a primary category requires a 30-consecutive-day passing
// benchmark streak (see src/lib/engines/dataforseo-demotion-gate.ts +
// docs/PRESENCEDATA_OS.md Patch J) — this static check is the redundant,
// import-free CI trap that catches a silent regression even before the
// runtime audit (which the /api/admin/benchmark-runs route also runs) fires.
// Non-greedy id->category match relies on router.ts's consistent field
// order (id, capability, category, ...) inside every adapter object literal.
const adapterCategoryPairs = [...router.matchAll(/id:\s*"([\w-]+)"[\s\S]*?category:\s*"([\w_]+)"/g)];
const dataForSeoAdapterPairs = adapterCategoryPairs.filter(([, id]) => id.startsWith("dataforseo"));
assert(
  dataForSeoAdapterPairs.length >= 2,
  "expected router.ts to still register at least the serp 'dataforseo' and backlinks 'dataforseo-backlinks' adapters — Patch J gates promotion, it must never silently remove DataForSEO before a benchmark proves replacement (plan rule 8)"
);
for (const [, id, category] of dataForSeoAdapterPairs) {
  assert(
    category === "fallback_only" || category === "benchmark_only",
    `Patch J invariant violated: paid DataForSEO adapter "${id}" in router.ts has category "${category}" — must stay "fallback_only"/"benchmark_only" until a 30-consecutive-day passing benchmark streak justifies otherwise`
  );
}

// Commercial claim policy — forbidden superiority / replacement phrases must
// not appear in customer-facing marketing surfaces (landing, agencies, tools).
// See docs/COMMERCIAL_CLAIM_POLICY.md. Product honesty docs may discuss the
// forbidden phrases as examples; those paths are excluded below.
const claimPolicy = read("docs/COMMERCIAL_CLAIM_POLICY.md");
assert(
  /Forbidden unless benchmark evidence exists/i.test(claimPolicy),
  "docs/COMMERCIAL_CLAIM_POLICY.md must define forbidden claims until benchmark evidence exists"
);
const marketingSurfaces = [
  "src/app/page.tsx",
  "src/app/agencies/page.tsx",
  "src/app/tools/page.tsx",
];
const forbiddenMarketing = [
  /better than ahrefs/i,
  /better than semrush/i,
  /replaced dataforseo/i,
  /we replaced dataforseo/i,
  /most accurate seo platform/i,
  /benchmark-proven provider parity/i,
  /30-day proven replacement/i,
  /commercial-grade backlink replacement/i,
];
for (const surface of marketingSurfaces) {
  let text = "";
  try {
    text = read(surface);
  } catch {
    continue;
  }
  for (const re of forbiddenMarketing) {
    assert(!re.test(text), `commercial claim policy: "${re}" must not appear in ${surface}`);
  }
}

if (failures.length) {
  console.error("\nOutput quality gate failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("");
  process.exit(1);
}

console.log("PASS — output quality gate");
