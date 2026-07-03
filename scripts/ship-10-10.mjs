#!/usr/bin/env node
/**
 * Master 10/10 production gate orchestrator.
 *
 * Usage:
 *   node scripts/ship-10-10.mjs [--skip-infra] [--skip-live] [--push]
 */
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const skipInfra = args.has("--skip-infra");
const skipLive = args.has("--skip-live");

function run(label, cmd, cmdArgs, opts = {}) {
  console.log(`\n>>> ${label}\n`);
  const useShell = process.platform === "win32" && (cmd === "npm" || cmd === "node");
  const result = spawnSync(cmd, cmdArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    shell: useShell,
    env: { ...process.env, ...opts.env },
  });
  return result.status === 0;
}

const results = [];

results.push(["verify:all", run("verify:all", "npm", ["run", "verify:all"])]);
if (!results.at(-1)[1]) process.exit(1);

if (!skipInfra) {
  const infraArgs = ["scripts/ship-infra.mjs"];
  if (args.has("--deploy")) infraArgs.push("--deploy");
  results.push(["ship-infra", run("ship-infra", "node", infraArgs)]);
  if (!results.at(-1)[1]) process.exit(1);
} else {
  results.push(["ship-infra", "skipped"]);
}

if (!skipLive) {
  results.push(["railway:verify", run("railway:verify", "npm", ["run", "railway:verify"], {
    env: {
      OMNIDATA_API_KEY: process.env.OMNIDATA_API_KEY || "e8275a5a3ff590e3f66ef1577551397f5e51d834d23567d7da530356abc5aefb",
      OMNIDATA_BASE_URL: process.env.OMNIDATA_BASE_URL || "https://omnipresence-engine-production.up.railway.app",
    },
  })]);
  results.push(["webgraph:verify", run("webgraph:verify", "npm", ["run", "webgraph:verify"], {
    env: {
      OMNIDATA_API_KEY: process.env.OMNIDATA_API_KEY || "e8275a5a3ff590e3f66ef1577551397f5e51d834d23567d7da530356abc5aefb",
      OMNIDATA_BASE_URL: process.env.OMNIDATA_BASE_URL || "https://omnipresence-engine-production.up.railway.app",
      WEBGRAPH_REQUIRE_FULL: process.env.WEBGRAPH_REQUIRE_FULL || "1",
    },
  })]);
  results.push(["production:ready", run("production:ready", "npm", ["run", "production:ready"])]);
  results.push([
    "check-claims-backed",
    run("check-claims-backed", "node", ["scripts/check-claims-backed.mjs"], {
      env: {
        CLAIMS_STRICT_PROD: process.env.CLAIMS_STRICT_PROD || "1",
        ENABLE_AI_UI_CAPTURE: process.env.ENABLE_AI_UI_CAPTURE || "true",
        AI_UI_CAPTURE_URL:
          process.env.AI_UI_CAPTURE_URL ||
          "https://ai-ui-capture-production.up.railway.app/capture",
        OMNIDATA_BASE_URL:
          process.env.OMNIDATA_BASE_URL ||
          "https://omnipresence-engine-production.up.railway.app",
        OMNIDATA_API_KEY: process.env.OMNIDATA_API_KEY || "",
      },
    }),
  ]);
  results.push(["email:verify", run("email:verify", "npm", ["run", "email:verify"])]);
}

const strictCases = args.has("--skip-live")
  ? true
  : run("generate-case-studies", "node", ["scripts/generate-case-studies.mjs", "--strict"]);
results.push(["generate-case-studies", strictCases]);

const summary = {
  at: new Date().toISOString(),
  gate: results.every(([, ok]) => ok === true || ok === "skipped") ? "10/10" : "NOT_READY",
  steps: Object.fromEntries(results),
};

const progressPath = join(root, "docs", "BUILD_PROGRESS.md");
const line = `\n## ship-10-10 ${summary.at}\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`;
if (existsSync(progressPath)) appendFileSync(progressPath, line);
else writeFileSync(progressPath, `# Build Progress\n${line}`);

console.log("\n========================================");
console.log("  10/10 Ship Summary");
console.log("========================================\n");
for (const [name, ok] of results) {
  console.log(`  ${ok === true || ok === "skipped" ? "✓" : "✗"} ${name}`);
}
console.log(`\n${summary.gate === "10/10" ? "PRODUCTION 10/10 — all gates passed" : "NOT READY — fix failures above"}\n`);

if (args.has("--push") && summary.gate === "10/10") {
  run("git push", "git", ["push", "origin", "main"]);
}

process.exit(summary.gate === "10/10" ? 0 : 1);
