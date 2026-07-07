#!/usr/bin/env node
/**
 * Sync Railway OmniData secrets into GitHub Actions (and optionally Vercel).
 * Keeps OMNIDATA_API_KEY aligned so production-gate railway:verify auth passes.
 *
 * Usage:
 *   node scripts/sync-ci-secrets.mjs [--github] [--vercel]
 *
 * Requires: railway CLI logged in, gh CLI authenticated, repo linked on Vercel for --vercel.
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const omnidataDir = join(root, "services", "omnidata");
const args = new Set(process.argv.slice(2));
const syncGithub = args.has("--github") || args.size === 0;
const syncVercel = args.has("--vercel");

const railwayBin = process.platform === "win32" ? "npx" : "railway";
const railwayPrefix = process.platform === "win32" ? ["@railway/cli"] : [];

function railwayVars() {
  const list = spawnSync(railwayBin, [...railwayPrefix, "variable", "list", "--service", "omnipresence-engine", "--json"], {
    cwd: omnidataDir,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (list.status !== 0) {
    console.error("Failed to read Railway variables. Run: npx @railway/cli login");
    process.exit(1);
  }
  try {
    return JSON.parse(list.stdout.trim());
  } catch {
    console.error("Invalid Railway variables JSON");
    process.exit(1);
  }
}

function ghSecretSet(name, value) {
  const set = spawnSync("gh", ["secret", "set", name, "--body", value], {
    cwd: root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (set.status !== 0) {
    console.error(`Failed gh secret set ${name}: ${set.stderr || set.stdout}`);
    process.exit(1);
  }
  console.log(`  ✓ GitHub secret ${name}`);
}

function vercelSet(key, value, targets = ["production", "preview"]) {
  for (const env of targets) {
    spawnSync("npx", ["vercel", "env", "rm", key, env, "--yes"], {
      cwd: root,
      shell: true,
      stdio: "ignore",
    });
    const add = spawnSync("npx", ["vercel", "env", "add", key, env, "--yes", "--sensitive"], {
      cwd: root,
      input: value,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });
    if (add.status !== 0) {
      console.error(`Failed Vercel ${key} on ${env}`);
      process.exit(1);
    }
    console.log(`  ✓ Vercel ${key} → ${env}`);
  }
}

const vars = railwayVars();
const apiKey = vars.OMNIDATA_API_KEY;
const signingSecret = vars.OMNIDATA_SIGNING_SECRET;
const baseUrl =
  vars.RAILWAY_PUBLIC_DOMAIN
    ? `https://${vars.RAILWAY_PUBLIC_DOMAIN}`
    : vars.OMNIDATA_BASE_URL || "https://omnipresence-engine-production.up.railway.app";

if (!apiKey || apiKey.length < 24) {
  console.error("Railway OMNIDATA_API_KEY missing or too short");
  process.exit(1);
}

console.log("\n=== sync-ci-secrets ===\n");
console.log(`OmniData base: ${baseUrl.replace(/\/$/, "")}\n`);

if (syncGithub) {
  console.log("GitHub Actions secrets:");
  ghSecretSet("OMNIDATA_API_KEY", apiKey);
  ghSecretSet("OMNIDATA_BASE_URL", baseUrl.replace(/\/$/, ""));
  if (signingSecret) ghSecretSet("OMNIDATA_SIGNING_SECRET", signingSecret);
}

if (syncVercel) {
  if (!existsSync(join(root, ".vercel", "project.json"))) {
    console.error("Run: npx vercel link");
    process.exit(1);
  }
  console.log("\nVercel production/preview:");
  vercelSet("OMNIDATA_BASE_URL", baseUrl.replace(/\/$/, ""));
  vercelSet("OMNIDATA_API_KEY", apiKey);
  if (signingSecret) vercelSet("OMNIDATA_SIGNING_SECRET", signingSecret);
}

console.log("\nDone. Re-run production gate: gh workflow run production-gate\n");
