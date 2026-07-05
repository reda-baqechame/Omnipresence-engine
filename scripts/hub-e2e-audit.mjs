#!/usr/bin/env node
/**
 * End-to-end hub audit orchestrator — infra, live scan, APIs, OAuth, hub routes.
 *
 * Usage:
 *   node scripts/hub-e2e-audit.mjs
 *   node scripts/hub-e2e-audit.mjs --project <id> --base <url> --require-oauth --skip-scan
 */
import { spawnSync } from "child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const projectId = arg("--project") || process.env.PROJECT_ID || "b1055406-874d-4f5b-975a-9be1bf6aabbf";
const base = (arg("--base") || process.env.SMOKE_BASE_URL || "https://omnipresence-engine.vercel.app").replace(/\/$/, "");
const requireOAuth = args.includes("--require-oauth");
const skipOAuth = args.includes("--skip-oauth");
const skipScan = args.includes("--skip-scan");
const strict = args.includes("--strict");
const reportDir = join(root, "reports");
mkdirSync(reportDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const reportPath = arg("--report") || join(reportDir, `hub-e2e-${stamp}.json`);

const results = [];

function record(id, name, status, detail, data) {
  results.push({ id, name, status, detail, data, at: new Date().toISOString() });
  const icon = status === "pass" ? "✓" : status === "warn" ? "○" : "✗";
  console.log(`  ${icon} ${name}: ${detail}`);
}

function runStep(name, cmd, cmdArgs, env = {}) {
  const useShell = process.platform === "win32" && (cmd === "npm" || cmd === "node");
  const r = spawnSync(cmd, cmdArgs, {
    cwd: root,
    encoding: "utf8",
    shell: useShell,
    env: { ...process.env, ...env },
    stdio: ["inherit", "pipe", "pipe"],
  });
  const ok = r.status === 0;
  const errTail = (r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" ");
  record(name, name, ok ? "pass" : "fail", ok ? "ok" : errTail);
  return ok;
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), ...opts });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, json };
}

console.log(`\n=== hub-e2e-audit ===`);
console.log(`  base: ${base}`);
console.log(`  project: ${projectId}`);
if (strict) console.log(`  strict: warn → fail`);
console.log("");

console.log("Schema + repo gates");
runStep("verify-all", "npm", ["run", "verify:all"]);

console.log("Infrastructure");
runStep("verify-prod", "npm", ["run", "verify:prod", base], { SMOKE_BASE_URL: base });
runStep("railway-verify", "npm", ["run", "railway:verify"]);
runStep("audit-live", "npm", ["run", "audit:live", base]);

const health = await fetchJson(`${base}/api/health`);
if (health.ok && health.json?.status === "healthy") {
  record("health", "Production health", "pass", `healthy · budgetMs=${health.json.scanEngines?.budgetMs}`);
} else {
  record("health", "Production health", "fail", `status ${health.status}`);
}

console.log("\nHub API probes (public tools)");
const citation = await fetchJson(`${base}/api/tools/citation-planner`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ brand: "Sirocco", industry: "skincare", location: "Canada", domain: "siroccoskin.com" }),
});
if (citation.ok && citation.json?.prompts?.length) {
  record("citation-planner", "Citation planner", "pass", `${citation.json.measured_count ?? 0} measured prompts`);
} else {
  record("citation-planner", "Citation planner", "fail", `HTTP ${citation.status}`);
}

const roiTool = await fetchJson(`${base}/api/tools/roi`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ organicSessions: 1000, monthlyAdSpend: 500, industry: "beauty" }),
});
if (roiTool.ok && roiTool.json?.methodology) {
  record("tools-roi", "Public ROI tool", "pass", roiTool.json.cpcSource || "ok");
} else {
  record("tools-roi", "Public ROI tool", "fail", `HTTP ${roiTool.status}`);
}

if (!skipScan) {
  console.log("\nLive scan (may take 15+ min)");
  const scanOk = runStep("scan-live", "npm", ["run", "scan:live", "--", projectId]);
  if (scanOk) {
    runStep("scan-failure-report", "node", ["scripts/scan-failure-report.mjs", "--project", projectId]);
  }
} else {
  record("scan-live", "Live scan", "warn", "skipped (--skip-scan)");
}

console.log("\nAuthenticated sweeps");
runStep("test-browser", "npm", ["run", "test:browser", base], { SMOKE_BASE_URL: base });
runStep("test-panels", "npm", ["run", "test:panels", base], { SMOKE_BASE_URL: base });
runStep("test-professional", "npm", ["run", "test:professional"]);

const oauthArgs = ["scripts/verify-oauth-connectors.mjs", projectId];
if (requireOAuth) oauthArgs.push("--require");
if (skipOAuth) {
  record("oauth-connectors", "OAuth connectors", "warn", "skipped (--skip-oauth)");
} else {
  runStep("oauth-connectors", "node", oauthArgs);
}

console.log("\nProject data");
runStep("audit-project-data", "node", ["scripts/audit-project-data.mjs", projectId]);

const hubRoutes = [
  "/ai-visibility",
  "/search-performance",
  "/content-site",
  "/authority-presence",
  "/competitors",
  "/action-proof",
  "/visibility",
  "/keywords",
  "/prompts",
  "/source-graph",
];

console.log("\nHub tab routes");
for (const route of hubRoutes) {
  const path = `/app/projects/${projectId}${route}`;
  try {
    const res = await fetch(`${base}${path}`, { redirect: "manual", signal: AbortSignal.timeout(45_000) });
    const status = res.status;
    record(`hub-${route}`, `Hub ${route}`, status === 200 || status === 307 ? "pass" : "fail", `HTTP ${status}`);
  } catch (e) {
    record(`hub-${route}`, `Hub ${route}`, "fail", e instanceof Error ? e.message : "fetch failed");
  }
}

const fails = results.filter((r) => r.status === "fail").length;
const warns = results.filter((r) => r.status === "warn").length;
const effectiveFails = fails + (strict ? warns : 0);
const summary = { base, projectId, fails, warns, strict, passes: results.filter((r) => r.status === "pass").length, at: new Date().toISOString() };

writeFileSync(reportPath, JSON.stringify({ summary, results }, null, 2));
console.log(`\nReport: ${reportPath}`);
console.log(`Summary: ${summary.passes} pass, ${warns} warn, ${fails} fail${strict && warns ? ` (${warns} warn treated as fail)` : ""}\n`);

process.exit(effectiveFails > 0 ? 1 : 0);
