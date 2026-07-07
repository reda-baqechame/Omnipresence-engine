#!/usr/bin/env node
/**
 * Ensure Upstash Redis is provisioned for distributed rate limiting.
 *
 * Usage:
 *   node scripts/ensure-upstash-redis.mjs [--provision]
 */
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const provision = process.argv.includes("--provision");

function hasUpstash() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.KV_URL ||
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.KV_REST_API_READ_ONLY_TOKEN ||
    "";
  return Boolean(url.trim() && token.trim());
}

function run(cmd, args) {
  return spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

console.log("\n=== ensure-upstash-redis ===\n");

if (hasUpstash()) {
  console.log("✓ Upstash Redis REST credentials detected in environment.\n");
  process.exit(0);
}

console.log("Upstash Redis is not configured (UPSTASH_REDIS_REST_URL + token or KV_REST_API_*).\n");
console.log("Production readiness requires distributed rate limiting.\n");

if (provision) {
  console.log("Provisioning via Vercel marketplace (Upstash for Redis)…\n");
  const r = run("npx", [
    "vercel",
    "integration",
    "add",
    "upstash/upstash-kv",
    "--name",
    "omnipresence-rate-limit",
    "-m",
    "primaryRegion=iad1",
    "-e",
    "production",
    "-e",
    "preview",
    "--plan",
    "paid",
    "--non-interactive",
  ]);
  if (r.status !== 0) {
    console.error("\nProvisioning did not complete — finish in Vercel dashboard if a browser step opened.\n");
    process.exit(1);
  }
  console.log("\nRedeploy: npx vercel deploy --prod\n");
  process.exit(0);
}

console.log("Manual options:");
console.log("  1. node scripts/ensure-upstash-redis.mjs --provision");
console.log("  2. Vercel → Integrations → Upstash for Redis → Connect");
console.log("  3. Upstash console → create DB → set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN on Vercel\n");
process.exit(1);
