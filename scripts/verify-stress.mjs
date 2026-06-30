#!/usr/bin/env node
/**
 * Stress gate: concurrency/burst + runaway-loop load against the in-process
 * protections that guard hot routes (rate limiter, LLM cost-guard). Asserts the
 * limits hold exactly, per-tenant isolation holds, nothing crashes, and latency
 * stays bounded under tens of thousands of calls.
 *
 * Discovers tests/stress/**\/*.stress.test.ts and runs them under node --test
 * with the app's `@/` resolver hook so the REAL primitives are exercised.
 */
import { spawnSync } from "child_process";
import { readdirSync, statSync, existsSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stressDir = join(root, "tests", "stress");

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (entry.endsWith(".stress.test.ts")) acc.push(full);
  }
  return acc;
}

// Repo-relative POSIX paths: the absolute repo path contains a space.
const files = walk(stressDir).map((f) => relative(root, f).split("\\").join("/"));

if (files.length === 0) {
  console.log("verify:stress — no stress test files found (tests/stress). Nothing to run.");
  process.exit(0);
}

console.log(`\n=== verify:stress — ${files.length} stress file(s) ===\n`);
for (const f of files) console.log(`  • ${f}`);
console.log("");

const r = spawnSync(
  "node",
  [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--import",
    "./tests/_lib/register-loader.mjs",
    "--test",
    ...files,
  ],
  { cwd: root, shell: true, stdio: "inherit", encoding: "utf8" }
);

process.exit(r.status === 0 ? 0 : 1);
