#!/usr/bin/env node
/**
 * E2E gate: public audit API sends preview email via Resend/SMTP.
 *
 * Requires RESEND_OWNER_EMAIL (Resend account owner inbox) when using
 * onboarding@resend.dev — Resend only delivers test sends to the account owner.
 *
 * Usage:
 *   node scripts/verify-audit-email.mjs [baseUrl]
 *   RESEND_OWNER_EMAIL=you@example.com npm run email:verify
 */
import { readFileSync, existsSync, unlinkSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base =
  process.argv[2] ||
  process.env.SMOKE_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://omnipresence-engine.vercel.app";
const pullPath = ".env.email.verify.tmp";
const testDomain = process.env.AUDIT_EMAIL_TEST_DOMAIN || "example.com";

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

function loadOwnerEmail() {
  if (process.env.RESEND_OWNER_EMAIL?.includes("@")) {
    return process.env.RESEND_OWNER_EMAIL.trim();
  }
  const providers = join(root, ".env.providers");
  if (existsSync(providers)) {
    const env = parseEnvFile(readFileSync(providers, "utf8"));
    const fromProviders =
      env.get("RESEND_OWNER_EMAIL") || env.get("RESEND_ACCOUNT_EMAIL") || env.get("EMAIL_FROM");
    if (fromProviders?.includes("@")) return fromProviders.trim();
  }
  return "redabaquechame58@gmail.com";
}

async function probeHealth() {
  const res = await fetch(`${base.replace(/\/$/, "")}/api/health`, {
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`health HTTP ${res.status}`);
  return res.json();
}

async function probeResendRecent(apiKey) {
  const res = await fetch("https://api.resend.com/emails?limit=5", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return res.json();
}

console.log("\n=== verify-audit-email ===");
console.log(`Target: ${base}\n`);

const ownerEmail = loadOwnerEmail();
console.log(`Using owner test inbox: ${ownerEmail}\n`);

let resendKey = process.env.RESEND_API_KEY;
if (!resendKey && existsSync(join(root, ".vercel", "project.json"))) {
  const pull = run(
    "npx",
    ["vercel", "env", "pull", pullPath, "--environment", "production", "--yes"],
    { capture: true }
  );
  if (pull.ok) {
    const env = parseEnvFile(readFileSync(join(root, pullPath), "utf8"));
    resendKey = env.get("RESEND_API_KEY");
    try {
      unlinkSync(join(root, pullPath));
    } catch {
      /* ignore */
    }
  }
}

const auditRes = await fetch(`${base.replace(/\/$/, "")}/api/public/audit`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    domain: testDomain,
    email: ownerEmail,
    brandName: "Email Verify",
    industry: "software",
  }),
  signal: AbortSignal.timeout(120_000),
});

if (!auditRes.ok) {
  const text = await auditRes.text().catch(() => "");
  console.error(`✗ Audit API HTTP ${auditRes.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
  process.exit(1);
}

const audit = await auditRes.json();
console.log("Audit response keys:", Object.keys(audit).join(", "));

if (audit.emailSent !== true) {
  console.error(`✗ emailSent !== true (${audit.emailSent})`);
  if (audit.emailError) console.error(`  emailError: ${audit.emailError}`);
  process.exit(1);
}
console.log("✓ emailSent: true");

try {
  const health = await probeHealth();
  // Unauthenticated /api/health returns a shallow { ok, status } payload and
  // intentionally omits production.checks (admin/bearer only). Treat that as
  // expected — emailSent above is the real gate.
  const emailCheck = health?.production?.checks?.find?.((c) => c.id === "email");
  if (emailCheck?.status === "ok") {
    console.log("✓ /api/health production email check: ok");
  } else if (health?.ok === true && !health?.production) {
    console.log("✓ /api/health public probe ok (production.checks require HEALTH_ADMIN_SECRET)");
  } else {
    console.warn(
      `⚠ /api/health email check: ${emailCheck?.status ?? "missing"} — deploy may be pending or probe unauthenticated`
    );
  }
} catch (err) {
  console.warn(`⚠ health probe skipped: ${err instanceof Error ? err.message : err}`);
}

if (resendKey?.startsWith("re_")) {
  try {
    const recent = await probeResendRecent(resendKey);
    if (recent?.data?.length) {
      const last = recent.data[0];
      console.log(`✓ Resend recent email: ${last.subject ?? last.id ?? "sent"}`);
    }
  } catch {
    /* optional */
  }
}

console.log("\nPASS — audit email pipeline verified\n");
process.exit(0);
