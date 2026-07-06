#!/usr/bin/env node
/**
 * Output-quality gate: protects users from fake/generic product output.
 *
 * This is intentionally static and fast so it can run in CI. Runtime tests still
 * verify plumbing; this gate verifies that customer-facing scans cannot regress
 * into demo data, generic roadmaps, or scattered navigation.
 */
import { readFileSync } from "fs";
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
const demoData = read("src/lib/demo/scan-data.ts");
const tabs = read("src/components/project-tabs.tsx");
const promptGenerator = read("src/lib/engines/prompt-generator.ts");
const roadmap = read("src/lib/engines/roadmap-generator.ts");
const provenanceBadge = read("src/components/provenance-badge.tsx");
const visibilityTable = read("src/components/visibility-table.tsx");

assert(!/generateDemo|resolveScanDemoMode/.test(scanRunner), "scan-runner must not import/call demo data generators");
assert(!/generateDemo|resolveScanDemoMode/.test(scanSteps), "scan-steps must not import/call demo data generators");
assert(!/Math\.random\(/.test(demoData), "demo scan-data must not generate randomized customer-looking output");
assert(/return false;/.test(demoData), "demo mode compatibility shim must return false");

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

if (failures.length) {
  console.error("\nOutput quality gate failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("");
  process.exit(1);
}

console.log("PASS — output quality gate");
