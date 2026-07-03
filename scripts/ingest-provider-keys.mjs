#!/usr/bin/env node
/**
 * Paste provider keys into .env.providers, push to Vercel/Railway, verify.
 *
 * Usage:
 *   node scripts/ingest-provider-keys.mjs [--push] [--verify]
 *   node scripts/ingest-provider-keys.mjs --set OPENAI_API_KEY=sk-...
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const providersPath = join(root, ".env.providers");
const push = process.argv.includes("--push");
const verify = process.argv.includes("--verify") || push;
const setArgs = process.argv.filter((a) => a.startsWith("--set=")).map((a) => a.slice(6));

const KEY_SLOTS = [
  { key: "OPENAI_API_KEY", tier: "P0", unlocks: "AI citation probes (ChatGPT)" },
  { key: "ANTHROPIC_API_KEY", tier: "P0", unlocks: "Claude visibility" },
  { key: "GOOGLE_GENERATIVE_AI_API_KEY", tier: "P0", unlocks: "Gemini / AI Overviews" },
  { key: "SERPER_API_KEY", tier: "P0", unlocks: "Live Google SERP (or use OmniData)" },
  { key: "GOOGLE_CLIENT_ID", tier: "P1", unlocks: "GSC/GA4 attribution (claim 12/12)" },
  { key: "GOOGLE_CLIENT_SECRET", tier: "P1", unlocks: "GSC/GA4 attribution" },
  { key: "PAGESPEED_API_KEY", tier: "P1", unlocks: "PageSpeed + CrUX + YouTube + KG + NLP (one GCP key)" },
  { key: "GOOGLE_CLOUD_API_KEY", tier: "P1", unlocks: "Alias for unified Google Cloud API key" },
  { key: "FIRECRAWL_API_KEY", tier: "P2", unlocks: "SERP + page scrape" },
  { key: "BRAVE_SEARCH_API_KEY", tier: "P2", unlocks: "Alternate SERP index" },
  { key: "RESEND_API_KEY", tier: "P2", unlocks: "Transactional email (custom domain for all leads)" },
];

function run(cmd, args) {
  return spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function upsertKey(key, value) {
  let lines = existsSync(providersPath)
    ? readFileSync(providersPath, "utf8").split("\n")
    : ["# Provider secrets (gitignored)\n"];
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  const row = `${key}=${value}`;
  if (idx >= 0) lines[idx] = row;
  else lines.push(row);
  writeFileSync(providersPath, lines.join("\n") + (lines.at(-1) === "" ? "" : "\n"));
}

console.log("\n=== ingest-provider-keys ===\n");

if (setArgs.length) {
  for (const pair of setArgs) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key && value) {
      upsertKey(key, value);
      console.log(`  ✓ ${key} updated in .env.providers`);
    }
  }
}

if (!existsSync(providersPath)) {
  console.error("Create .env.providers first (copy from .env.example INFRA section)\n");
  process.exit(1);
}

const envText = readFileSync(providersPath, "utf8");
console.log("Key slots:\n");
for (const slot of KEY_SLOTS) {
  const line = envText.split("\n").find((l) => l.startsWith(`${slot.key}=`));
  const val = line?.split("=").slice(1).join("=").trim() || "";
  const ok = val && !val.startsWith("your-") && val.length > 8;
  console.log(`  ${ok ? "✓" : "○"} [${slot.tier}] ${slot.key} — ${slot.unlocks}`);
}

if (push) {
  console.log("\nPushing to Vercel…\n");
  const p = run("npm", ["run", "env:push"]);
  if (p.status !== 0) process.exit(p.status ?? 1);
}

if (verify) {
  console.log("\nVerifying providers…\n");
  const v = run("npm", ["run", "verify:providers", ".env.providers"]);
  console.log("\nClaims benchmark…\n");
  const c = run("node", ["scripts/check-claims-backed.mjs"], {
    /* env inherited */
  });
  process.exit(v.status === 0 && c.status === 0 ? 0 : 1);
}

console.log("\nPaste keys into .env.providers then run:\n  npm run keys:ingest -- --push --verify\n");
