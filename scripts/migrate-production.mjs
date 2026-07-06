#!/usr/bin/env node
/**
 * Apply pending migrations to production Supabase via Vercel env vars.
 * Usage: node scripts/migrate-production.mjs
 */

import { spawnSync } from "child_process";
import { existsSync, unlinkSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env.vercel.tmp");

function run(cmd, args, env = process.env) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  return result.status === 0;
}

function resolveDatabaseUrl(envPath) {
  const text = readFileSync(envPath, "utf8");
  const keys = ["POSTGRES_URL_NON_POOLING", "DATABASE_URL", "SUPABASE_DB_URL", "POSTGRES_URL"];
  for (const key of keys) {
    for (const line of text.split("\n")) {
      if (!line.startsWith(`${key}=`)) continue;
      const raw = line.slice(key.length + 1).trim().replace(/^"|"$/g, "");
      if (!raw) continue;
      return raw.includes("sslmode=")
        ? raw.replace(/sslmode=[^&]+/, "sslmode=no-verify")
        : `${raw}${raw.includes("?") ? "&" : "?"}sslmode=no-verify`;
    }
  }
  return null;
}

console.log("\n=== Production DB migrate ===\n");

if (!run("vercel", ["env", "pull", ".env.vercel.tmp", "--environment=production", "-y"])) {
  process.exit(1);
}

const databaseUrl = resolveDatabaseUrl(envFile);
if (!databaseUrl) {
  console.error("No POSTGRES_URL_NON_POOLING / DATABASE_URL in pulled Vercel env.");
  process.exit(1);
}

// apply-migrations.mjs: transactional, version-column tracking (see schema-migrations-utils.mjs)
const migrated = run("node", ["scripts/apply-migrations.mjs", "--required"], {
  DATABASE_URL: databaseUrl,
});

if (existsSync(envFile)) {
  try {
    unlinkSync(envFile);
  } catch {
    /* ignore */
  }
}

process.exit(migrated ? 0 : 1);
