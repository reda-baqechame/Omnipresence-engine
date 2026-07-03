#!/usr/bin/env node
/** Apply migrations using Vercel-pulled env (POSTGRES_URL_NON_POOLING). */
import { spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.migrate.tmp");
if (!existsSync(envPath)) {
  console.error("Missing .env.migrate.tmp — run: vercel env pull .env.migrate.tmp --environment=production");
  process.exit(1);
}

let raw = "";
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  if (line.startsWith("POSTGRES_URL_NON_POOLING=")) {
    raw = line.slice("POSTGRES_URL_NON_POOLING=".length).trim().replace(/^"|"$/g, "");
    break;
  }
}
if (!raw) {
  console.error("POSTGRES_URL_NON_POOLING not in .env.migrate.tmp");
  process.exit(1);
}

const conn = raw.includes("sslmode=")
  ? raw.replace(/sslmode=[^&]+/, "sslmode=no-verify")
  : `${raw}${raw.includes("?") ? "&" : "?"}sslmode=no-verify`;

const result = spawnSync("node", ["scripts/apply-migrations.mjs", ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, DATABASE_URL: conn },
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
