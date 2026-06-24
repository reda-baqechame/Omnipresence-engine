#!/usr/bin/env node
/** Push env vars to Vercel production via stdin (vercel env add) */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = process.argv[2] || path.join(__dirname, "../.env.production.local");

if (!fs.existsSync(envPath)) {
  console.error("Missing env file:", envPath);
  process.exit(1);
}

const lines = fs.readFileSync(envPath, "utf8").split("\n");
const vars = {};
for (const line of lines) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const key = t.slice(0, eq).trim();
  let val = t.slice(eq + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  vars[key] = val;
}

const skip = new Set(["VERCEL", "VERCEL_ENV", "VERCEL_URL", "TURBO_*"]);
let ok = 0;
let fail = 0;

for (const [key, value] of Object.entries(vars)) {
  if (!value || skip.has(key)) continue;
  console.log(`Setting ${key}...`);
  const r = spawnSync("vercel", ["env", "add", key, "production", "--force"], {
    input: value,
    encoding: "utf8",
    shell: true,
  });
  if (r.status === 0) ok++;
  else {
    fail++;
    console.error(r.stderr || r.stdout);
  }
}

console.log(`Done: ${ok} set, ${fail} failed`);
