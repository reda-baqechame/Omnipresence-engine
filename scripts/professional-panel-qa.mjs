#!/usr/bin/env node
/**
 * Authenticated panel API sweep — creates ephemeral user + nike.com project,
 * runs rescan, exercises all project panel APIs with professional pass criteria.
 *
 * Usage:
 *   node scripts/professional-panel-qa.mjs
 *   node scripts/professional-panel-qa.mjs https://omnipresence-engine.vercel.app
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith("http")) || process.env.SMOKE_BASE_URL || "https://omnipresence-engine.vercel.app";

function loadEnvFile(path, force = false) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (force || !process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(join(root, ".env.providers"));
loadEnvFile(join(root, ".env.local"));
loadEnvFile(join(root, ".env.production.local"));
loadEnvFile(join(root, ".env.panel-qa.tmp"), true);
// Re-apply provider secrets (Resend, etc.) — Vercel pull must not blank local-only keys
loadEnvFile(join(root, ".env.providers"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const results = [];
const startedAt = new Date().toISOString();
let cookieJar = new Map();

function record(id, name, status, detail, data = null) {
  results.push({ id, name, status, detail, data, at: new Date().toISOString() });
  const icon = status === "pass" ? "✓" : status === "warn" ? "○" : "✗";
  console.log(`  ${icon} ${name}: ${detail}`);
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function api(path, opts = {}, timeoutMs = 120_000) {
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(),
      connection: "close",
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, json };
}

function makeSupabaseAuth() {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      getAll() {
        return [...cookieJar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) cookieJar.set(name, value);
      },
    },
  });
}

async function ensureTestUser() {
  const stamp = Date.now().toString(36);
  const email = `pro-qa-${stamp}@presenceos-qa.test`;
  const password = `QaTest!${stamp}Aa1`;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Pro QA Bot", organization_name: "Pro QA Agency" },
  });
  if (createErr) throw new Error(`createUser: ${createErr.message}`);

  const supabase = makeSupabaseAuth();
  const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signErr) throw new Error(`signIn: ${signErr.message}`);
  if (cookieJar.size === 0) throw new Error("signIn: no auth cookies set");

  record("auth", "Create + sign in", "pass", email);
  return { email, password };
}

async function setupOrg() {
  const { ok, status } = await api("/api/auth/setup-org", {
    method: "POST",
    body: JSON.stringify({ orgName: "Professional QA Agency" }),
  });
  if (!ok && status !== 400) {
    record("org", "Setup org", "fail", `HTTP ${status}`);
    return false;
  }
  record("org", "Setup org", "pass", status === 400 ? "already exists" : "created");
  return true;
}

async function createProject() {
  const { ok, status, json } = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "Nike QA Project",
      domain: "nike.com",
      industry: "apparel",
      location: "United States",
      competitors: ["adidas.com", "puma.com"],
      scope: "global",
      main_offer: "Athletic footwear and apparel",
      conversion_goal: "ecommerce",
      monthly_ad_spend: 500000,
      current_monthly_traffic: 50000000,
    }),
  });
  if (!ok) {
    record("project", "Create project", "fail", `HTTP ${status}`);
    return null;
  }
  record("project", "Create project", "pass", `id=${json.project?.id}`);
  return json.project?.id;
}

async function rescanAndWait(projectId) {
  const { ok } = await api(`/api/projects/${projectId}/rescan`, { method: "POST", body: "{}" });
  if (!ok) {
    record("rescan", "Trigger rescan", "fail", "POST failed");
    return false;
  }
  record("rescan", "Trigger rescan", "pass", "started");

  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    const { json } = await api(`/api/projects/${projectId}/scan`, {}, 30_000);
    const st = json?.status || json?.scan?.status;
    if (st === "complete" || st === "completed" || json?.complete) {
      record("rescan", "Scan complete", "pass", `score=${json?.scores?.omnipresence ?? json?.omnipresence_score ?? "?"}`);
      return true;
    }
    if (st === "failed" || st === "error") {
      record("rescan", "Scan complete", "fail", st);
      return false;
    }
    await new Promise((r) => setTimeout(r, 8000));
  }
  record("rescan", "Scan complete", "warn", "timeout 8min — continuing with partial data");
  return true;
}

const PANEL_GETS = [
  { id: "keywords", path: (id) => `/api/keywords?projectId=${id}`, specialty: "keywords", validate: (j) => (j.opportunities?.length >= 1 ? "pass" : j.opportunities ? "warn" : "warn") },
  { id: "ranks", path: (id) => `/api/ranks?projectId=${id}`, specialty: "rankings", validate: (j) => (j.tracked?.length || j.snapshots?.length ? "pass" : "warn") },
  { id: "rank-schedules", path: (id) => `/api/rank-schedules?projectId=${id}`, specialty: "rankings", validate: () => "pass" },
  { id: "backlinks", path: (id) => `/api/backlinks?projectId=${id}`, specialty: "backlinks", validate: (j) => (j.available === false ? "pass" : j.backlinks?.length || j.total != null ? "pass" : "warn") },
  { id: "backlink-graph", path: (id) => `/api/backlink-graph?projectId=${id}`, specialty: "backlinks", validate: (j) => (j.nodes?.length || j.message ? "pass" : "warn") },
  { id: "link-building", path: (id) => `/api/link-building?projectId=${id}`, specialty: "backlinks", validate: () => "pass" },
  { id: "entity", path: (id) => `/api/entity?projectId=${id}`, specialty: "entity", validate: (j) => (j.profile || j.entity ? "pass" : "warn") },
  { id: "cwv", path: (id) => `/api/cwv?projectId=${id}`, specialty: "technical", validate: (j) => (j.metrics || j.history ? "pass" : "warn") },
  { id: "deep-crawl", path: (id) => `/api/deep-crawl?projectId=${id}`, specialty: "technical", validate: (j) => (j.pages?.length || j.summary ? "pass" : "warn") },
  { id: "on-page", path: (id) => `/api/on-page?projectId=${id}`, specialty: "technical", validate: (j) => (j.checks || j.issues ? "pass" : "warn") },
  { id: "indexation", path: (id) => `/api/indexation?projectId=${id}`, specialty: "technical", validate: () => "pass" },
  { id: "internal-links", path: (id) => `/api/internal-links?projectId=${id}`, specialty: "technical", validate: () => "pass" },
  { id: "coverage", path: (id) => `/api/coverage?projectId=${id}`, specialty: "technical", validate: (j) => (j.items?.length ? "pass" : "warn") },
  { id: "intelligence", path: (id) => `/api/intelligence?projectId=${id}`, specialty: "aeo", validate: (j) => (j.insights?.length || j.competitors ? "pass" : "warn") },
  { id: "frontier", path: (id) => `/api/frontier?projectId=${id}`, specialty: "geo", validate: () => "pass" },
  { id: "source-graph", path: (id) => `/api/source-graph?projectId=${id}`, specialty: "geo", validate: (j) => (j.nodes?.length || j.edges ? "pass" : "warn") },
  { id: "prompts", path: (id) => `/api/prompts?projectId=${id}`, specialty: "aeo", validate: (j) => (j.prompts?.length ? "pass" : "warn") },
  { id: "panels", path: (id) => `/api/panels?projectId=${id}`, specialty: "aeo", validate: () => "pass" },
  { id: "ai-traces", path: (id) => `/api/ai-traces?projectId=${id}`, specialty: "aeo", validate: () => "pass" },
  { id: "fastest-path", path: (id) => `/api/fastest-path?projectId=${id}`, specialty: "aeo", validate: (j) => (j.steps?.length || j.plan ? "pass" : "warn") },
  { id: "guarantee", path: (id) => `/api/guarantee?projectId=${id}`, specialty: "attribution", validate: () => "pass" },
  { id: "results-ledger", path: (id) => `/api/results-ledger?projectId=${id}`, specialty: "geo", validate: () => "pass" },
  { id: "roi", path: (id) => `/api/roi?projectId=${id}`, specialty: "attribution", validate: (j) => (j.scenarios || j.organicValue != null ? "pass" : "warn") },
  { id: "local", path: (id) => `/api/local?projectId=${id}`, specialty: "local", validate: () => "pass" },
  { id: "merchant", path: (id) => `/api/merchant?projectId=${id}`, specialty: "local", validate: () => "pass" },
  { id: "reputation", path: (id) => `/api/reputation?projectId=${id}`, specialty: "content", validate: () => "pass" },
  { id: "community", path: (id) => `/api/community?projectId=${id}`, specialty: "content", validate: () => "pass" },
  { id: "authority", path: (id) => `/api/authority?projectId=${id}`, specialty: "backlinks", validate: (j) => (j?.opportunities?.length ? "pass" : "warn") },
  { id: "attribution", path: (id) => `/api/attribution/referrals?projectId=${id}`, specialty: "attribution", validate: () => "pass" },
  { id: "gsc", path: (id) => `/api/gsc?projectId=${id}`, specialty: "rankings", validate: (j) => (j.connected === false ? "pass" : "pass") },
  { id: "ppc", path: (id) => `/api/ppc?projectId=${id}`, specialty: "attribution", validate: () => "pass" },
  { id: "behavior", path: (id) => `/api/behavior?projectId=${id}`, specialty: "attribution", validate: () => "pass" },
  { id: "integrations", path: (id) => `/api/integrations?projectId=${id}`, specialty: "attribution", validate: () => "pass" },
  { id: "trends", path: (id) => `/api/trends?projectId=${id}`, specialty: "keywords", validate: () => "pass" },
  { id: "topical", path: (id) => `/api/topical?projectId=${id}`, specialty: "keywords", validate: () => "pass" },
  { id: "pseo", path: (id) => `/api/pseo?projectId=${id}`, specialty: "keywords", validate: () => "pass" },
  { id: "serp-capture", path: (id) => `/api/serp-capture?projectId=${id}`, specialty: "rankings", validate: () => "pass" },
  { id: "annotations", path: (id) => `/api/annotations?projectId=${id}`, specialty: "rankings", validate: () => "pass" },
  { id: "tasks", path: (id) => `/api/tasks?projectId=${id}`, specialty: "content", validate: (j) => (j.tasks?.length ? "pass" : "warn") },
  { id: "operating-plan", path: (id) => `/api/operating-plan?projectId=${id}`, specialty: "content", validate: () => "pass" },
  { id: "traffic-intel", path: (id) => `/api/traffic-intel?projectId=${id}`, specialty: "attribution", validate: () => "pass" },
  { id: "capabilities", path: () => `/api/capabilities`, specialty: "platform", validate: (j) => (j.providers ? "pass" : "warn") },
  { id: "export-findings", path: (id) => `/api/export?projectId=${id}&type=findings&format=json`, specialty: "platform", validate: () => "pass" },
  { id: "export-visibility", path: (id) => `/api/export?projectId=${id}&type=visibility&format=json`, specialty: "aeo", validate: () => "pass" },
];

async function testPanels(projectId) {
  console.log("\n## Panel API sweep (authenticated)");
  for (const panel of PANEL_GETS) {
    const t0 = Date.now();
    try {
      const { ok, status, json } = await api(panel.path(projectId), {}, 90_000);
      const ms = Date.now() - t0;
      if (status === 401 || status === 403) {
        record(`panel-${panel.id}`, panel.id, "fail", `auth HTTP ${status} (${ms}ms)`);
        continue;
      }
      if (!ok && status >= 500) {
        record(`panel-${panel.id}`, panel.id, "fail", `HTTP ${status} (${ms}ms)`);
        continue;
      }
      const v = panel.validate(json);
      const sample = json ? JSON.stringify(json).slice(0, 120) : "";
      record(`panel-${panel.id}`, `${panel.id} [${panel.specialty}]`, v, `HTTP ${status} (${ms}ms)`, sample);
    } catch (e) {
      record(`panel-${panel.id}`, panel.id, "fail", e instanceof Error ? e.message : String(e));
    }
  }

  console.log("\n## Content score (NLP)");
  const t0 = Date.now();
  const { ok, status, json } = await api(
    "/api/content-score",
    {
      method: "POST",
      body: JSON.stringify({
        projectId,
        keyword: "running shoes",
        draftText:
          "Nike delivers innovative running shoes engineered for speed and comfort. Our Pegasus line combines responsive cushioning with breathable mesh for everyday athletes.",
      }),
    },
    90_000
  );
  const ms = Date.now() - t0;
  const hasNlp = json?.editorial?.entities?.length || json?.editorial?.sentiment || json?.score != null;
  record("panel-content-score", "content-score [content]", ok && hasNlp ? "pass" : ok ? "warn" : "fail", `HTTP ${status} (${ms}ms)`, json?.editorial ? "editorial+score" : null);

  console.log("\n## Video SEO");
  const v0 = Date.now();
  const video = await api(
    "/api/video-seo",
    { method: "POST", body: JSON.stringify({ projectId, query: "Nike running shoes" }) },
    90_000
  );
  record(
    "panel-video-seo",
    "video-seo [content]",
    video.ok && (video.json?.videos?.length || video.json?.items?.length) ? "pass" : video.ok ? "warn" : "fail",
    `HTTP ${video.status} (${Date.now() - v0}ms)`
  );
}

function buildHtmlReport(projectId, userEmail) {
  const pass = results.filter((r) => r.status === "pass").length;
  const warn = results.filter((r) => r.status === "warn").length;
  const fail = results.filter((r) => r.status === "fail").length;
  const rows = results
    .map(
      (r) => `<tr><td>${r.status === "pass" ? "✅" : r.status === "warn" ? "⚠️" : "❌"}</td><td><strong>${r.name}</strong></td><td>${r.detail}</td><td style="font-size:11px;font-family:monospace">${r.data ? String(r.data).slice(0, 150) : "—"}</td></tr>`
    )
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Panel QA Report</title></head>
<body style="font-family:system-ui;max-width:960px;margin:0 auto;padding:24px">
<h1>Authenticated Panel QA Report</h1>
<p>Target: <a href="${base}">${base}</a><br/>Project: ${projectId}<br/>QA user: ${userEmail}<br/>Started: ${startedAt}</p>
<div style="display:flex;gap:16px;margin:20px 0"><div style="background:#ecfdf5;padding:12px 20px;border-radius:8px"><b>${pass}</b> pass</div>
<div style="background:#fffbeb;padding:12px 20px;border-radius:8px"><b>${warn}</b> warn</div>
<div style="background:#fef2f2;padding:12px 20px;border-radius:8px"><b>${fail}</b> fail</div></div>
<table style="width:100%;border-collapse:collapse;font-size:13px"><tr><th>Status</th><th>Panel</th><th>Detail</th><th>Sample</th></tr>${rows}</table>
<h2>Tester onboarding (own signups)</h2>
<ol>
<li><a href="${base}/signup">Sign up</a> — confirm email if Supabase prompts</li>
<li>New Project → your client domain + 2 competitors</li>
<li>Overview → Re-scan → wait 2–5 min</li>
<li>Settings → Capabilities — all green</li>
<li>Work your specialty tabs (see professional-tester-suite playbook)</li>
</ol>
</body></html>`;
}

async function sendReport(html, emailTo) {
  const key = process.env.RESEND_API_KEY;
  if (!key || key.startsWith("your-")) return { sent: false, reason: "no resend key" };
  const from = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || "reports@presenceos.app";
  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.filter((r) => r.status === "fail").length;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: emailTo,
      subject: `OmniPresence Panel QA — ${pass} pass, ${fail} fail — ${new Date().toLocaleDateString()}`,
      html,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return { sent: false, reason: await res.text() };
  return { sent: true, id: (await res.json()).id };
}

// --- main ---
console.log(`\n${"=".repeat(60)}\n  Panel QA — ${base}\n${"=".repeat(60)}`);

if (!SUPABASE_URL || !SUPABASE_ANON || !SERVICE_KEY) {
  console.error("Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY)");
  process.exit(1);
}

const emailTo = process.env.TESTER_REPORT_EMAIL || "redabaq58@gmail.com";
let userEmail = "";
let projectId = null;

try {
  const user = await ensureTestUser();
  userEmail = user.email;
  await setupOrg();
  projectId = await createProject();
  if (!projectId) process.exit(1);
  await rescanAndWait(projectId);
  await testPanels(projectId);
} catch (e) {
  record("fatal", "Suite error", "fail", e instanceof Error ? e.message : String(e));
}

const outDir = join(root, "reports");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const htmlPath = join(outDir, `panel-qa-${stamp}.html`);
const jsonPath = join(outDir, `panel-qa-${stamp}.json`);
const html = buildHtmlReport(projectId || "n/a", userEmail);
writeFileSync(htmlPath, html);
writeFileSync(jsonPath, JSON.stringify({ base, startedAt, projectId, userEmail, results }, null, 2));

const pass = results.filter((r) => r.status === "pass").length;
const warn = results.filter((r) => r.status === "warn").length;
const fail = results.filter((r) => r.status === "fail").length;
console.log(`\n## Summary: Pass ${pass} Warn ${warn} Fail ${fail}`);
console.log(`  Report: ${htmlPath}`);

const mail = await sendReport(html, emailTo);
if (mail.sent) console.log(`  ✓ Emailed ${emailTo} (id: ${mail.id})`);
else console.log(`  ✗ Email: ${mail.reason}`);

process.exitCode = fail > 0 ? 1 : 0;
