#!/usr/bin/env node
/** One-shot: set HEALTH_ADMIN_SECRET on Vercel + save to .env.operator.local */
import { randomBytes } from "crypto";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const secret = randomBytes(32).toString("hex");
const operatorPath = join(root, ".env.operator.local");

let existing = "";
if (existsSync(operatorPath)) {
  existing = readFileSync(operatorPath, "utf8");
}
const withoutOld = existing
  .split("\n")
  .filter((line) => !line.trim().startsWith("HEALTH_ADMIN_SECRET="))
  .join("\n")
  .trim();
const body = (withoutOld ? `${withoutOld}\n` : "") + `HEALTH_ADMIN_SECRET=${secret}\n`;
writeFileSync(operatorPath, body, "utf8");

for (const env of ["production", "preview"]) {
  spawnSync("npx", ["vercel", "env", "rm", "HEALTH_ADMIN_SECRET", env, "--yes"], {
    cwd: root,
    shell: process.platform === "win32",
    stdio: "ignore",
  });
  const add = spawnSync(
    "npx",
    ["vercel", "env", "add", "HEALTH_ADMIN_SECRET", env, "--yes", "--sensitive"],
    {
      cwd: root,
      input: secret,
      encoding: "utf8",
      shell: process.platform === "win32",
    }
  );
  if (add.status !== 0) {
    console.error(`Failed to set HEALTH_ADMIN_SECRET on ${env}`);
    process.exit(1);
  }
  console.log(`✓ HEALTH_ADMIN_SECRET → ${env}`);
}

console.log(`✓ Saved to .env.operator.local`);
console.log("Run: npm run verify:prod:live");
