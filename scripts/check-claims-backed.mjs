#!/usr/bin/env node
/**
 * Verify claims registry backing (optionally strict in prod).
 * Usage: CLAIMS_STRICT_PROD=1 node scripts/check-claims-backed.mjs
 */
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.env.CLAIMS_STRICT_PROD === "1";

const result = spawnSync("node", ["scripts/benchmark.mjs", ...(strict ? ["--strict"] : [])], {
  cwd: root,
  encoding: "utf8",
  env: process.env,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const match = (result.stdout || "").match(/Backed by current capabilities: (\d+)\/(\d+)/);
if (!match) {
  console.error("check-claims-backed: could not parse benchmark output");
  process.exit(1);
}

const backed = Number(match[1]);
const total = Number(match[2]);
console.log(`\ncheck-claims-backed: ${backed}/${total} claims backed`);

if (strict && backed < total) {
  console.error(`CLAIMS_STRICT_PROD: need ${total}/${total}, got ${backed}/${total}`);
  process.exit(1);
}

process.exit(result.status === 0 ? 0 : 1);
