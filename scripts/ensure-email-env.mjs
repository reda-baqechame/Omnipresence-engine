#!/usr/bin/env node
/**
 * Ensure transactional email env vars exist on Vercel (Resend or SMTP).
 * Reads missing keys from .env.providers and probes the Resend API.
 *
 * Usage: node scripts/ensure-email-env.mjs [--deploy] [--strict]
 */
import { readFileSync, existsSync, unlinkSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deploy = process.argv.includes("--deploy");
const strict = process.argv.includes("--strict");
const pullPath = ".env.email.ensure.tmp";
const providersPath = join(root, ".env.providers");
const DEFAULT_FROM = "onboarding@resend.dev";

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: opts.capture ? ["pipe", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  return {
    ok: result.status === 0,
    out: (result.stdout || "") + (result.stderr || ""),
  };
}

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

function needs(map, key) {
  const v = map.get(key);
  return !v || !v.trim() || v.startsWith("your-") || v === '""';
}

function vercelAdd(key, value, targets = ["production", "preview"]) {
  for (const env of targets) {
    run("npx", ["vercel", "env", "rm", key, env, "--yes"], { capture: true });
    const add = run(
      "npx",
      ["vercel", "env", "add", key, env, "--value", value, "--yes", "--sensitive"],
      { capture: true }
    );
    if (!add.ok) {
      console.error(`Failed to set ${key} on ${env}:`, add.out);
      return false;
    }
    console.log(`  ✓ ${key} → ${env}`);
  }
  return true;
}

async function probeResend(apiKey) {
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend probe HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
  }
  return "account ok";
}

console.log("\n=== ensure-email-env ===\n");

if (!existsSync(join(root, ".vercel", "project.json"))) {
  console.error("No .vercel/project.json — run: npx vercel link\n");
  process.exit(1);
}

const pull = run(
  "npx",
  ["vercel", "env", "pull", pullPath, "--environment", "production", "--yes"],
  { capture: true }
);
if (!pull.ok) {
  console.error("Could not pull Vercel production env:", pull.out);
  process.exit(1);
}

const vercelEnv = parseEnvFile(readFileSync(join(root, pullPath), "utf8"));
try {
  unlinkSync(join(root, pullPath));
} catch {
  /* ignore */
}

const localEnv = existsSync(providersPath)
  ? parseEnvFile(readFileSync(providersPath, "utf8"))
  : new Map();

const emailKeys = ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "EMAIL_FROM"];
const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];

const hasSmtp = !needs(vercelEnv, "SMTP_HOST");
const hasResend = !needs(vercelEnv, "RESEND_API_KEY");

if (!hasResend && !hasSmtp) {
  const resendKey = localEnv.get("RESEND_API_KEY");
  if (resendKey && resendKey.startsWith("re_")) {
    console.log("Pushing Resend keys from .env.providers to Vercel:\n");
    vercelAdd("RESEND_API_KEY", resendKey);
    const from = localEnv.get("RESEND_FROM_EMAIL") || localEnv.get("EMAIL_FROM") || DEFAULT_FROM;
    vercelAdd("RESEND_FROM_EMAIL", from, ["production", "preview"]);
    vercelAdd("EMAIL_FROM", from, ["production", "preview"]);
    vercelEnv.set("RESEND_API_KEY", resendKey);
    vercelEnv.set("RESEND_FROM_EMAIL", from);
    vercelEnv.set("EMAIL_FROM", from);
  } else {
    console.error(
      "No email transport on Vercel. Add to .env.providers then re-run:\n" +
        "  RESEND_API_KEY=re_...\n" +
        `  RESEND_FROM_EMAIL=${DEFAULT_FROM}\n` +
        `  EMAIL_FROM=${DEFAULT_FROM}\n` +
        "Or set SMTP_HOST (+ optional SMTP_USER/SMTP_PASS).\n"
    );
    if (strict) process.exit(1);
    process.exit(0);
  }
}

if (!needs(vercelEnv, "RESEND_FROM_EMAIL") && needs(vercelEnv, "EMAIL_FROM")) {
  vercelAdd("EMAIL_FROM", vercelEnv.get("RESEND_FROM_EMAIL"));
}

if (!needs(vercelEnv, "RESEND_API_KEY")) {
  try {
    const status = await probeResend(vercelEnv.get("RESEND_API_KEY"));
    console.log(`✓ Resend probe: ${status}\n`);
  } catch (err) {
    console.error(`✗ Resend probe failed: ${err instanceof Error ? err.message : err}\n`);
    if (strict) process.exit(1);
  }
} else if (hasSmtp) {
  console.log(`✓ SMTP configured (${vercelEnv.get("SMTP_HOST")})\n`);
} else {
  console.error("✗ No working email transport configured.\n");
  if (strict) process.exit(1);
}

if (deploy) {
  console.log("Triggering production deploy…\n");
  const dep = run("npx", ["vercel", "deploy", "--prod", "--yes"]);
  if (!dep.ok) process.exit(1);
}

process.exit(0);
