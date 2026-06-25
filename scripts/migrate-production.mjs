#!/usr/bin/env node
/**
 * Apply pending migrations to production Supabase via Vercel env vars.
 * Usage: node scripts/migrate-production.mjs
 */

import { spawnSync } from "child_process";
import { existsSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env.vercel.tmp");

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status === 0;
}

console.log("\n=== Production DB migrate ===\n");

if (!run("vercel", ["env", "pull", ".env.vercel.tmp", "--environment=production", "-y"])) {
  process.exit(1);
}

const migrated = run("node", ["--env-file=.env.vercel.tmp", "scripts/run-migration.mjs"]);

if (existsSync(envFile)) {
  try {
    unlinkSync(envFile);
  } catch {
    /* ignore */
  }
}

process.exit(migrated ? 0 : 1);
