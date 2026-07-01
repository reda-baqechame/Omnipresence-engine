#!/usr/bin/env node
/**
 * Wire Railway OmniData + ai-ui-capture URLs into Vercel production.
 * Generates shared secrets if omitted. Redeploys Vercel when --deploy.
 *
 * Usage:
 *   node scripts/wire-railway-prod.mjs \
 *     --omnidata https://omnidata-xxx.up.railway.app \
 *     --capture https://capture-xxx.up.railway.app \
 *     [--deploy]
 *
 * Or set OMNIDATA_PUBLIC_URL + AI_CAPTURE_PUBLIC_URL in the environment.
 */
import { randomBytes } from "crypto";
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const deploy = args.includes("--deploy");
const omnidataUrl = (arg("--omnidata") || process.env.OMNIDATA_PUBLIC_URL || "").replace(/\/$/, "");
const captureUrl = (arg("--capture") || process.env.AI_CAPTURE_PUBLIC_URL || "").replace(/\/$/, "");

if (!omnidataUrl || !captureUrl) {
  console.error("\nwire-railway-prod: need --omnidata and --capture public Railway URLs\n");
  process.exit(1);
}

if (!existsSync(join(root, ".vercel", "project.json"))) {
  console.error("Run: npx vercel link\n");
  process.exit(1);
}

const omnidataKey = process.env.OMNIDATA_API_KEY || randomBytes(32).toString("hex");
const signingSecret = process.env.OMNIDATA_SIGNING_SECRET || randomBytes(32).toString("hex");
const captureKey = process.env.AI_UI_CAPTURE_KEY || randomBytes(32).toString("hex");

function vercelSet(key, value, targets = ["production", "preview"]) {
  for (const env of targets) {
    spawnSync("npx", ["vercel", "env", "rm", key, env, "--yes"], {
      cwd: root,
      shell: true,
      stdio: "ignore",
    });
    const add = spawnSync(
      "npx",
      ["vercel", "env", "add", key, env, "--value", value, "--yes", "--sensitive"],
      { cwd: root, shell: true, encoding: "utf8" }
    );
    if (add.status !== 0) {
      console.error(`Failed ${key} on ${env}`);
      process.exit(1);
    }
    console.log(`  ✓ Vercel ${key} → ${env}`);
  }
}

console.log("\n=== wire-railway-prod ===\n");
console.log(`OmniData: ${omnidataUrl}`);
console.log(`AI capture: ${captureUrl}\n`);

const pairs = [
  ["OMNIDATA_BASE_URL", omnidataUrl],
  ["OMNIDATA_API_KEY", omnidataKey],
  ["OMNIDATA_SIGNING_SECRET", signingSecret],
  ["ENABLE_AI_UI_CAPTURE", "true"],
  ["AI_UI_CAPTURE_URL", `${captureUrl}/capture`],
  ["AI_UI_CAPTURE_KEY", captureKey],
  ["NEXT_PUBLIC_APP_URL", "https://omnipresence-engine.vercel.app"],
];

for (const [k, v] of pairs) vercelSet(k, v);

console.log("\nSet these SAME secrets on Railway services:\n");
console.log("  omnidata-api / worker:");
console.log(`    OMNIDATA_API_KEY=${omnidataKey}`);
console.log(`    OMNIDATA_SIGNING_SECRET=${signingSecret}`);
console.log("    REDIS_URL=<Railway Redis plugin URL>");
console.log("    SERPER_API_KEY=<optional — copy from Vercel for real SERP>");
console.log("\n  ai-ui-capture:");
console.log(`    AI_UI_CAPTURE_KEY=${captureKey}`);
console.log(`    PORT=8788`);

if (deploy) {
  console.log("\nDeploying Vercel production…\n");
  const dep = spawnSync("npx", ["vercel", "deploy", "--prod", "--yes"], {
    cwd: root,
    shell: true,
    stdio: "inherit",
  });
  process.exit(dep.status === 0 ? 0 : 1);
}

console.log("\nRun after Railway env is set:");
console.log(`  OMNIDATA_BASE_URL=${omnidataUrl} AI_UI_CAPTURE_URL=${captureUrl} npm run railway:verify\n`);
