#!/usr/bin/env node
/**
 * One-command Stripe go-live (Master Plan v4 Phase 3).
 *
 * Everything after "create a Stripe account" is automated here:
 *   1. Creates the three products + monthly prices (Solo $29 / Growth $79 /
 *      Agency $199) — idempotent via price lookup_keys, safe to re-run.
 *   2. Creates the production webhook endpoint (checkout completed +
 *      subscription deleted) — idempotent by URL.
 *   3. Pushes STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and the three
 *      STRIPE_PRICE_* ids to Vercel (production + preview).
 *   4. With --enforce, flips FREE_ACCESS_MODE=false so plan limits are live.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/bootstrap-stripe.mjs [--enforce]
 *
 * Then redeploy (git push or `npx vercel --prod`) so the new env is picked up.
 */
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const key = process.env.STRIPE_SECRET_KEY;
const enforce = process.argv.includes("--enforce");
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://omnipresence-engine.vercel.app";

if (!key || !key.startsWith("sk_")) {
  console.error("Set STRIPE_SECRET_KEY (sk_live_... or sk_test_...) and re-run.");
  console.error("Get it at https://dashboard.stripe.com/apikeys");
  process.exit(1);
}

async function stripe(method, path, params) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(params ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${json.error?.message || res.status}`);
  return json;
}

const PLANS = [
  { slug: "solo", name: "PresenceOS Solo", amount: 2900 },
  { slug: "growth", name: "PresenceOS Growth", amount: 7900 },
  { slug: "agency", name: "PresenceOS Agency", amount: 19900 },
];

const priceIds = {};
for (const plan of PLANS) {
  const lookupKey = `presenceos_${plan.slug}_monthly`;
  const existing = await stripe("GET", `/prices?lookup_keys[]=${lookupKey}&limit=1&active=true`);
  if (existing.data?.length) {
    priceIds[plan.slug] = existing.data[0].id;
    console.log(`= ${plan.name}: price exists (${existing.data[0].id})`);
    continue;
  }
  const product = await stripe("POST", "/products", {
    name: plan.name,
    "metadata[plan]": plan.slug,
  });
  const price = await stripe("POST", "/prices", {
    product: product.id,
    unit_amount: String(plan.amount),
    currency: "usd",
    "recurring[interval]": "month",
    lookup_key: lookupKey,
    "metadata[plan]": plan.slug,
  });
  priceIds[plan.slug] = price.id;
  console.log(`+ ${plan.name}: $${plan.amount / 100}/mo -> ${price.id}`);
}

const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/webhooks/stripe`;
const endpoints = await stripe("GET", "/webhook_endpoints?limit=100");
let webhookSecret = null;
const found = endpoints.data?.find((e) => e.url === webhookUrl && e.status === "enabled");
if (found) {
  console.log(`= Webhook endpoint exists (${found.id}) — secret not re-readable; keeping current STRIPE_WEBHOOK_SECRET.`);
} else {
  const created = await stripe("POST", "/webhook_endpoints", {
    url: webhookUrl,
    "enabled_events[0]": "checkout.session.completed",
    "enabled_events[1]": "customer.subscription.deleted",
  });
  webhookSecret = created.secret;
  console.log(`+ Webhook endpoint ${created.id} -> ${webhookUrl}`);
}

function setVercelEnv(name, value, sensitive = true) {
  for (const env of ["production", "preview"]) {
    spawnSync("npx", ["vercel", "env", "rm", name, env, "--yes"], {
      cwd: root,
      shell: process.platform === "win32",
      stdio: "ignore",
    });
    const args = ["vercel", "env", "add", name, env, "--yes"];
    if (sensitive) args.push("--sensitive");
    const add = spawnSync("npx", args, {
      cwd: root,
      input: value,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    if (add.status !== 0) {
      console.error(`Failed to set ${name} on ${env}: ${add.stderr || add.stdout}`);
      process.exit(1);
    }
  }
  console.log(`✓ ${name} -> Vercel (production + preview)`);
}

setVercelEnv("STRIPE_SECRET_KEY", key);
if (webhookSecret) setVercelEnv("STRIPE_WEBHOOK_SECRET", webhookSecret);
setVercelEnv("STRIPE_PRICE_SOLO", priceIds.solo, false);
setVercelEnv("STRIPE_PRICE_GROWTH", priceIds.growth, false);
setVercelEnv("STRIPE_PRICE_AGENCY", priceIds.agency, false);
if (enforce) setVercelEnv("FREE_ACCESS_MODE", "false", false);

console.log("\nDone. Next steps:");
console.log("  1. Redeploy: git push (or `npx vercel --prod`) so the new env is live.");
if (!enforce) {
  console.log("  2. When ready to enforce plan limits: re-run with --enforce (sets FREE_ACCESS_MODE=false).");
}
console.log("  3. Test checkout: /pricing -> subscribe with card 4242 4242 4242 4242 (test mode).");
