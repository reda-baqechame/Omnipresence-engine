#!/usr/bin/env node
/**
 * E2E registration via /api/auth/register (production path).
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createServerClient } from "@supabase/ssr";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv.find((a) => a.startsWith("http")) || "https://omnipresence-engine.vercel.app";

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim().replace(/^"|"$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(join(root, ".env.migrate.tmp"));

const stamp = Date.now().toString(36);
const email = `redabaq58+qa${stamp}@gmail.com`;
const password = `RealTest!${stamp}Aa1`;
const orgName = `QA Agency ${stamp}`;

const jar = new Map();

console.log("1. POST /api/auth/register …");
const reg = await fetch(`${base}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, fullName: "QA User", orgName }),
});
const regJson = await reg.json();
if (!reg.ok || !regJson.ok) {
  console.error("✗ register:", reg.status, JSON.stringify(regJson));
  process.exit(1);
}
console.log("✓ Registered, needsLogin:", regJson.needsLogin);

// Collect session cookies from Set-Cookie if any
const setCookie = reg.headers.getSetCookie?.() || [];
for (const c of setCookie) {
  const [pair] = c.split(";");
  const eq = pair.indexOf("=");
  if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
}

if (regJson.needsLogin) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const sb = createServerClient(url, anon, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("✗ signIn after register:", error.message);
    process.exit(1);
  }
}

const cookieHdr = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
console.log("2. create project …");
const proj = await fetch(`${base}/api/projects`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieHdr },
  body: JSON.stringify({ name: "Register API Test", domain: "web.dev", industry: "tech", competitors: [] }),
});
const projJson = await proj.json();
if (!proj.ok) {
  console.error("✗ project:", proj.status, JSON.stringify(projJson).slice(0, 300));
  process.exit(1);
}
console.log("✓ Project:", projJson.project?.id);
console.log("\n✓ Registration E2E PASS —", email);
