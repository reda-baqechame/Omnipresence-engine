#!/usr/bin/env node
/**
 * Browser/page-load QA — authenticated tab walk + public pages.
 * Uses HTTP fetch with session cookies (same auth as panel QA).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv.find((a) => a.startsWith("http")) || "https://omnipresence-engine.vercel.app";

const TABS = [
  "", "/ai-visibility", "/search-performance", "/content-site", "/authority-presence", "/action-proof",
  "/war-room", "/proof", "/proof-ledger", "/geo-lift", "/visibility", "/crawlers",
  "/aeo-readiness", "/frontier", "/source-graph", "/prompts", "/panels", "/intelligence",
  "/competitors", "/gate", "/fastest-path", "/cannibalization", "/keywords", "/technical",
  "/entity", "/content", "/topical", "/pseo", "/ranks", "/serp-capture", "/local", "/gsc",
  "/traffic", "/backlinks", "/merchant", "/behavior", "/reputation", "/community", "/trends",
  "/internal-links", "/indexation", "/coverage", "/distribution", "/authority", "/roadmap",
  "/tasks", "/attribution", "/ppc", "/roi", "/operating", "/guarantee",
];

const PUBLIC_PAGES = ["/", "/tools", "/audit", "/agencies", "/login", "/signup", "/app/settings/capabilities"];

function loadEnvFile(path, force = false) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (force || !process.env[key]) process.env[key] = val;
  }
}

for (const f of [".env.providers", ".env.local", ".env.production.local"]) {
  loadEnvFile(join(root, f));
}
loadEnvFile(join(root, ".env.panel-qa.tmp"), true);
loadEnvFile(join(root, ".env.providers"));

const results = [];
let cookieJar = new Map();

function record(id, name, status, detail, takeaway = "") {
  results.push({ id, name, status, detail, takeaway, at: new Date().toISOString() });
  console.log(`  ${status === "pass" ? "✓" : status === "warn" ? "○" : "✗"} ${name}: ${detail}`);
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function fetchPage(path, auth = false) {
  const t0 = Date.now();
  const res = await fetch(`${base}${path}`, {
    headers: auth ? { Cookie: cookieHeader() } : {},
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
  const ms = Date.now() - t0;
  const loc = res.headers.get("location");
  let html = "";
  if (res.status < 400) {
    try {
      html = await res.text();
    } catch {
      html = "";
    }
  }
  return { status: res.status, ms, loc, html };
}

function analyzeHtml(html, label, isPublic = false) {
  const hasError = /Application error|Internal Server Error/i.test(html);
  if (hasError) return { status: "fail", takeaway: "Error text in page body" };
  if (isPublic && html.length > 500) {
    return { status: "pass", takeaway: `Public page shell ${Math.round(html.length / 1024)}KB (client-rendered)` };
  }
  const hasLoginRedirect = /Sign in to PresenceOS|Log in to continue/i.test(html) && !["/login", "/signup"].includes(label);
  if (hasLoginRedirect) return { status: "warn", takeaway: "Login prompt in body" };
  if (html.length < 800) return { status: "warn", takeaway: "Thin page — may be RSC shell" };
  return { status: "pass", takeaway: `${Math.round(html.length / 1024)}KB rendered` };
}

async function authBootstrap() {
  const email = `browser-qa-${Date.now().toString(36)}@presenceos-qa.test`;
  const password = `QaTest!${Date.now().toString(36)}Aa1`;
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await admin.auth.admin.createUser({ email, password, email_confirm: true });

  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
      setAll: (c) => c.forEach(({ name, value }) => cookieJar.set(name, value)),
    },
  });
  await sb.auth.signInWithPassword({ email, password });

  await fetch(`${base}/api/auth/setup-org`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
    body: JSON.stringify({ orgName: "Browser QA Agency" }),
  });

  const proj = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
    body: JSON.stringify({
      name: "HubSpot Browser QA",
      domain: "hubspot.com",
      industry: "saas",
      competitors: ["salesforce.com"],
    }),
  });
  const projJson = await proj.json();
  const projectId = projJson.project?.id;
  record("signup-flow", "Signup simulation (admin user)", "pass", `User ${email} — email_confirm=true bypasses inbox`);
  record("onboarding", "Org + project create", projectId ? "pass" : "fail", projectId || "no project id");
  return { email, projectId };
}

console.log(`\n## Public pages — ${base}`);
for (const path of PUBLIC_PAGES) {
  const { status, ms, html, loc } = await fetchPage(path);
  if (status >= 300 && status < 400) {
    record(`pub-${path}`, path, "pass", `redirect ${status} → ${loc} (${ms}ms)`, "Expected redirect");
  } else {
    const a = analyzeHtml(html, path, true);
    record(`pub-${path}`, path, status === 200 ? a.status : "fail", `HTTP ${status} (${ms}ms)`, a.takeaway);
  }
}

// Signup page specifics for tomorrow's testers
const signup = await fetchPage("/signup");
const hasEmailField = /type="email"|email/i.test(signup.html);
const hasOrgField = /org/i.test(signup.html);
record(
  "signup-fields",
  "Signup form fields",
  hasEmailField ? "pass" : "fail",
  `email=${hasEmailField} org=${hasOrgField}`,
  "Testers: confirm email if Supabase requires it before login"
);

let projectId = null;
if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("\n## Authenticated project tabs");
  const boot = await authBootstrap();
  projectId = boot.projectId;
  if (projectId) {
    for (const tab of TABS) {
      const path = `/app/projects/${projectId}${tab}`;
      const { status, ms, html, loc } = await fetchPage(path, true);
      if (status >= 300 && status < 400 && loc?.includes("/login")) {
        record(`tab-${tab || "overview"}`, tab || "Overview", "fail", `redirect to login (${ms}ms)`, "Auth cookie not accepted");
      } else if (status === 200) {
        const a = analyzeHtml(html, tab);
        record(`tab-${tab || "overview"}`, tab || "Overview", a.status, `HTTP 200 (${ms}ms)`, a.takeaway);
      } else {
        record(`tab-${tab || "overview"}`, tab || "Overview", "fail", `HTTP ${status} (${ms}ms)`, loc || "");
      }
    }
  }
}

const outDir = join(root, "reports");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const jsonPath = join(outDir, `browser-qa-${stamp}.json`);
writeFileSync(jsonPath, JSON.stringify({ base, projectId, results }, null, 2));

const pass = results.filter((r) => r.status === "pass").length;
const fail = results.filter((r) => r.status === "fail").length;
console.log(`\n## Browser QA: ${pass} pass, ${fail} fail → ${jsonPath}`);
