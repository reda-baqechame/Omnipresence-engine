#!/usr/bin/env node
/**
 * Provision Resend for audit emails: create API key via Resend API when a
 * full-access key exists, or bootstrap from .env.providers / env.
 *
 * Usage:
 *   node scripts/provision-resend-key.mjs
 *   RESEND_FULL_ACCESS_KEY=re_... node scripts/provision-resend-key.mjs
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const providersPath = join(root, ".env.providers");
const DEFAULT_FROM = "onboarding@resend.dev";
const OWNER_EMAIL = process.env.RESEND_OWNER_EMAIL || "redabaquechame58@gmail.com";

function parseEnvFile(text) {
  const map = new Map();
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    map.set(key, v);
  }
  return map;
}

function upsertProviders(entries) {
  const existing = existsSync(providersPath)
    ? readFileSync(providersPath, "utf8")
    : "# Provider secrets (gitignored)\n";
  const lines = existing.split("\n");
  for (const [key, value] of entries) {
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    const row = `${key}=${value}`;
    if (idx >= 0) lines[idx] = row;
    else lines.push(row);
  }
  writeFileSync(providersPath, lines.filter((l, i, a) => l.length || i < a.length - 1).join("\n") + "\n");
  console.log(`Wrote ${providersPath}`);
}

async function createSendingKey(fullAccessKey) {
  const res = await fetch("https://api.resend.com/api-keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fullAccessKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "omnipresence-audit",
      permission: "sending_access",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`create api key HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  const token = body.token || body.id;
  if (!token || !String(token).startsWith("re_")) {
    throw new Error(`Unexpected api key response: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return String(token);
}

async function probeKey(apiKey) {
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`probe HTTP ${res.status}`);
}

console.log("\n=== provision-resend-key ===\n");

let apiKey =
  process.env.RESEND_API_KEY ||
  process.env.RESEND_SENDING_KEY ||
  (existsSync(providersPath) ? parseEnvFile(readFileSync(providersPath, "utf8")).get("RESEND_API_KEY") : null);

if (apiKey?.startsWith("re_")) {
  try {
    await probeKey(apiKey);
    console.log("✓ Existing RESEND_API_KEY is valid\n");
  } catch (err) {
    console.warn(`Existing key invalid: ${err instanceof Error ? err.message : err}`);
    apiKey = null;
  }
}

if (!apiKey && process.env.RESEND_FULL_ACCESS_KEY?.startsWith("re_")) {
  console.log("Creating sending key from full-access key…\n");
  apiKey = await createSendingKey(process.env.RESEND_FULL_ACCESS_KEY);
  console.log("✓ Created sending API key\n");
}

if (!apiKey?.startsWith("re_")) {
  console.error(
    "No valid Resend API key found.\n\n" +
      "1. Verify the Resend signup email sent to your inbox (redabaquechame58@gmail.com).\n" +
      "2. Open https://resend.com/api-keys → Create API key (Sending access).\n" +
      "3. Add to .env.providers:\n" +
      "     RESEND_API_KEY=re_...\n" +
      `     RESEND_FROM_EMAIL=${DEFAULT_FROM}\n` +
      `     EMAIL_FROM=${DEFAULT_FROM}\n` +
      `     RESEND_OWNER_EMAIL=${OWNER_EMAIL}\n` +
      "4. Re-run: npm run email:ensure -- --deploy\n"
  );
  process.exit(1);
}

upsertProviders([
  ["RESEND_API_KEY", apiKey],
  ["RESEND_FROM_EMAIL", DEFAULT_FROM],
  ["EMAIL_FROM", DEFAULT_FROM],
  ["RESEND_OWNER_EMAIL", OWNER_EMAIL],
]);

const push = spawnSync("npm", ["run", "env:push"], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (push.status !== 0) process.exit(push.status ?? 1);

console.log("\n✓ Resend provisioned — run: npm run email:ensure -- --deploy\n");
