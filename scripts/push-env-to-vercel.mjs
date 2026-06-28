#!/usr/bin/env node
/**
 * Bulk-push environment variables to Vercel (production by default).
 *
 * Reads a local env file (default: .env.providers — gitignored) and, for each
 * KEY=VALUE, sets it on the linked Vercel project. Existing values are replaced.
 *
 * Usage:
 *   node scripts/push-env-to-vercel.mjs                  # .env.providers -> production
 *   node scripts/push-env-to-vercel.mjs .env.providers production preview development
 *   node scripts/push-env-to-vercel.mjs --dry-run        # show what would change
 *
 * Requires the Vercel CLI to be linked (a .vercel/project.json must exist).
 * Secret values are never printed (only key names + masked length).
 */

import { readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname, isAbsolute } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const positional = args.filter((a) => !a.startsWith("--"));
const fileArg = positional[0] || ".env.providers";
const targets = positional.slice(1).length ? positional.slice(1) : ["production"];

const filePath = isAbsolute(fileArg) ? fileArg : join(root, fileArg);
if (!existsSync(filePath)) {
  console.error(`\nEnv file not found: ${fileArg}`);
  console.error(`Create it (KEY=VALUE per line) then re-run. It is gitignored.\n`);
  process.exit(1);
}

if (!existsSync(join(root, ".vercel", "project.json"))) {
  console.error("\nNo .vercel/project.json — run `npx vercel link` first.\n");
  process.exit(1);
}

function parse(path) {
  const entries = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!key || !v) continue;
    if (v.startsWith("your-") || v.startsWith("https://your")) continue; // skip placeholders
    entries.push([key, v]);
  }
  return entries;
}

function vercel(argv, input) {
  return spawnSync("npx", ["vercel", ...argv], {
    cwd: root,
    input,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

const entries = parse(filePath);
if (entries.length === 0) {
  console.error("\nNo non-placeholder KEY=VALUE pairs found in the env file.\n");
  process.exit(1);
}

console.log(`\nPushing ${entries.length} variable(s) to Vercel [${targets.join(", ")}]${DRY ? " (dry run)" : ""}:\n`);

let ok = 0;
let failed = 0;
for (const [key, value] of entries) {
  const masked = `len=${value.length}`;
  if (DRY) {
    console.log(`  • ${key} (${masked})`);
    continue;
  }
  for (const target of targets) {
    // Replace any existing value: remove (ignore failure) then add.
    vercel(["env", "rm", key, target, "--yes"]);
    const res = vercel(["env", "add", key, target], value);
    if (res.status === 0) {
      ok++;
      console.log(`  ✓ ${key} -> ${target} (${masked})`);
    } else {
      failed++;
      const err = (res.stderr || res.stdout || "").trim().split("\n").slice(-1)[0];
      console.log(`  ✗ ${key} -> ${target}: ${err}`);
    }
  }
}

if (!DRY) {
  console.log(`\nDone: ${ok} set, ${failed} failed.`);
  console.log(`Redeploy for changes to take effect:  npx vercel deploy --prod\n`);
}
process.exit(failed > 0 ? 1 : 0);
