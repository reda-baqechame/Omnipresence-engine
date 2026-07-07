#!/usr/bin/env node
/**
 * Run verify-production with operator secrets from .env.operator.local
 * (written by ensure-prod-env when HEALTH_ADMIN_SECRET is generated).
 */
import { readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const operatorPath = join(root, ".env.operator.local");

if (existsSync(operatorPath)) {
  for (const line of readFileSync(operatorPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v) process.env[key] = v;
  }
}

const verify = spawnSync(process.execPath, [join(root, "scripts/verify-production.mjs")], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
process.exit(verify.status ?? 1);
