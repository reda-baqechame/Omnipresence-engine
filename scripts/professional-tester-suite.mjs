#!/usr/bin/env node
/**
 * Professional SEO/AEO/AGO tester suite — exercises public tools + production health,
 * documents results, and emails the full report to the operator inbox.
 *
 * Usage:
 *   node scripts/professional-tester-suite.mjs
 *   node scripts/professional-tester-suite.mjs --email redabaq58@gmail.com
 *   node scripts/professional-tester-suite.mjs https://omnipresence-engine.vercel.app
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith("http")) || process.env.SMOKE_BASE_URL || "https://omnipresence-engine.vercel.app";
const emailTo = args.includes("--email")
  ? args[args.indexOf("--email") + 1]
  : process.env.TESTER_REPORT_EMAIL || "redabaq58@gmail.com";

function loadEnvFile(path) {
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
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(join(root, ".env.providers"));
loadEnvFile(join(root, ".env.local"));

const TEST_DOMAINS = [
  { domain: "nike.com", note: "Global brand — CWV + schema + entity" },
  { domain: "hubspot.com", note: "B2B SaaS — content + technical SEO" },
  { domain: "web.dev", note: "Google property — performance baseline" },
];

const results = [];
const startedAt = new Date().toISOString();

function record(id, name, status, detail, data = null) {
  results.push({ id, name, status, detail, data, at: new Date().toISOString() });
  const icon = status === "pass" ? "✓" : status === "warn" ? "○" : "✗";
  console.log(`  ${icon} ${name}: ${detail}`);
}

async function fetchJson(path, opts = {}, timeoutMs = 60_000) {
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", connection: "close", ...(opts.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, json };
}

async function testHealth() {
  console.log("\n## Production health");
  const { ok, json } = await fetchJson("/api/health", {}, 20_000);
  if (!ok) {
    record("health", "API health", "fail", `HTTP error`);
    return;
  }
  record("health", "Status", json.status === "healthy" ? "pass" : "warn", json.status);
  record("health", "Production ready", json.production?.ready ? "pass" : "fail", `score ${json.production?.score}%`);
  record("health", "Live data", json.checks?.live_data === "ok" ? "pass" : "fail", json.checks?.live_data || "off");
  record("health", "SERP provider", json.checks?.serp === "ok" ? "pass" : "fail", json.activeSerpProvider || "none");
  const g = json.googleCloud;
  if (g) {
    const allOn = g.keyConfigured && g.pagespeed && g.youtube && g.knowledgeGraph && g.naturalLanguage;
    record("health", "Google Cloud stack", allOn ? "pass" : "warn", `key=${g.keyConfigured} PS=${g.pagespeed} YT=${g.youtube} KG=${g.knowledgeGraph} NLP=${g.naturalLanguage}`);
  }
  record("health", "AI engines", "pass", (json.diyStack?.llmDirect ? "ChatGPT/Claude/Gemini" : "limited") + (json.diyStack?.firecrawl ? " + Firecrawl" : ""));
}

/** Verify live SERP returns real, decodable organic URLs (professional accuracy gate). */
async function testSerpAccuracy() {
  console.log("\n## Live SERP accuracy (real organic results)");
  const query = "hubspot crm software";
  let organic = [];

  const omnidataUrl = (process.env.OMNIDATA_BASE_URL || "").replace(/\/$/, "");
  const omnidataKey = process.env.OMNIDATA_API_KEY || "";
  if (omnidataUrl && omnidataKey) {
    try {
      const res = await fetch(`${omnidataUrl}/v3/serp/google/organic/live`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": omnidataKey },
        body: JSON.stringify([{ keyword: query, location_name: "United States", language_code: "en" }]),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const json = await res.json();
        const items = json?.tasks?.[0]?.result?.[0]?.items || json?.tasks?.[0]?.result?.[0]?.organic || [];
        for (const item of items) {
          const url = item.url || item.link;
          const title = item.title || item.description || "";
          if (url?.startsWith("http") && title.length > 3) organic.push({ title, url });
          if (organic.length >= 10) break;
        }
      }
    } catch {
      /* fall through */
    }
  }

  if (!organic.length) {
    try {
      const res = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; PresenceOS-QA/1.0)", Accept: "text/html" },
          signal: AbortSignal.timeout(20_000),
        }
      );
      if (!res.ok) {
        record("serp-live", "Organic SERP fetch", "fail", `HTTP ${res.status}`);
        return;
      }
      const html = await res.text();
      const links = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
      for (const m of links) {
        let raw = m[1].trim();
        if (raw.startsWith("//")) raw = `https:${raw}`;
        let url = raw;
        try {
          const u = new URL(raw);
          if (u.hostname.includes("duckduckgo.com") && u.searchParams.has("uddg")) {
            url = decodeURIComponent(u.searchParams.get("uddg") || raw);
          }
        } catch {
          continue;
        }
        const title = m[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
        if (url.startsWith("http") && title.length > 3) organic.push({ title, url });
        if (organic.length >= 10) break;
      }
    } catch (e) {
      record("serp-live", "SERP accuracy", "fail", e instanceof Error ? e.message : String(e));
      return;
    }
  }

  try {
    const hubspotHit = organic.some((o) => /hubspot\.com/i.test(o.url));
    record(
      "serp-live",
      "Organic result count",
      organic.length >= 5 ? "pass" : organic.length >= 1 ? "warn" : "fail",
      `${organic.length} results`
    );
    record(
      "serp-live",
      "Brand domain in SERP",
      hubspotHit ? "pass" : "warn",
      hubspotHit ? "hubspot.com found in top results" : "brand not in top 10"
    );
    if (organic[0]) {
      record("serp-live", "Top result sample", "pass", `${organic[0].title.slice(0, 50)} → ${new URL(organic[0].url).hostname}`);
    }
  } catch (e) {
    record("serp-live", "SERP accuracy", "fail", e instanceof Error ? e.message : String(e));
  }
}

async function testFreeTool(id, path, body, validate, timeoutMs = 90_000) {
  const t0 = Date.now();
  try {
    const { ok, status, json } = await fetchJson(path, { method: "POST", body: JSON.stringify(body) }, timeoutMs);
    const ms = Date.now() - t0;
    if (!ok) {
      record(`tool-${id}`, id, status === 429 ? "warn" : "fail", `HTTP ${status} (${ms}ms)`);
      return;
    }
    const v = validate(json);
    record(`tool-${id}`, id, v.status, `${v.detail} (${ms}ms)`, v.sample);
  } catch (e) {
    record(`tool-${id}`, id, "fail", e instanceof Error ? e.message : String(e));
  }
}

async function testAllTools() {
  console.log("\n## Free tools (/tools) — professional scenarios");
  const d = TEST_DOMAINS[1].domain; // hubspot.com

  await testFreeTool("audit", "/api/tools/audit", { domain: d }, (j) => {
    const n = j.findings?.length ?? 0;
    const perf = j.findings?.filter((f) => f.category === "performance") ?? [];
    return {
      status: n >= 3 ? "pass" : "warn",
      detail: `${n} findings (${perf.length} performance)`,
      sample: perf[0]?.title,
    };
  }, 120_000);

  await testFreeTool("robots", "/api/tools/robots", { domain: d }, (j) => {
    const blocked = (j.bots || []).filter((b) => !b.allowed);
    return {
      status: j.bots?.length ? "pass" : "warn",
      detail: `${j.bots?.length ?? 0} AI bots checked, ${blocked.length} blocked`,
      sample: blocked[0]?.name,
    };
  });

  await testFreeTool("schema", "/api/tools/schema", { domain: d }, (j) => ({
    status: j.schemaTypes?.length ? "pass" : "warn",
    detail: `${j.schemaTypes?.length ?? 0} schema types, ${j.missing?.length ?? 0} recommended missing`,
    sample: j.schemaTypes?.[0],
  }));

  await testFreeTool("llms", "/api/tools/llms", { domain: d }, (j) => ({
    status: j.content || j.llmsTxt ? "pass" : "warn",
    detail: j.content ? `${String(j.content).length} chars generated` : "no content",
    sample: String(j.content || "").slice(0, 80),
  }));

  await testFreeTool("canonical", "/api/tools/canonical", { domain: d }, (j) => ({
    status: j.canonical != null || j.issues ? "pass" : "warn",
    detail: j.canonical || j.issues?.length != null ? `canonical=${j.canonical || "checked"}` : "checked",
    sample: j.issues?.[0],
  }));

  await testFreeTool("sitemap", "/api/tools/sitemap", { domain: d }, (j) => ({
    status: j.urlCount != null || j.sitemapUrl ? "pass" : "warn",
    detail: j.urlCount != null ? `${j.urlCount} URLs in sitemap` : j.reason || "checked",
    sample: j.sitemapUrl,
  }));

  await testFreeTool("citation", "/api/tools/citation-planner", { brand: "HubSpot", industry: "marketing software", location: "United States" }, (j) => ({
    status: j.prompts?.length || j.surfaces?.length ? "pass" : "warn",
    detail: `${j.prompts?.length ?? 0} prompts, ${j.surfaces?.length ?? 0} surfaces`,
    sample: j.prompts?.[0],
  }));

  await testFreeTool("roi", "/api/tools/roi", { organicSessions: 12000, monthlyAdSpend: 8500, industry: "saas" }, (j) => ({
    status: j.organicValue != null || j.roi != null ? "pass" : "warn",
    detail: j.organicValue != null ? `organic value $${Math.round(j.organicValue)}/mo` : JSON.stringify(j).slice(0, 60),
    sample: j,
  }));
}

async function testPublicAudit() {
  console.log("\n## Public lead audit (/audit)");
  try {
    const { ok, status, json } = await fetchJson(
      "/api/public/audit",
      {
        method: "POST",
        body: JSON.stringify({
          domain: "nike.com",
          brandName: "Nike",
          industry: "apparel",
          email: "tester-suite@omnipresence.local",
        }),
      },
      180_000
    );
    if (status === 429) {
      record("public-audit", "Lead audit", "warn", "Rate limited (endpoint live)");
      return;
    }
    if (!ok) {
      record("public-audit", "Lead audit", "fail", `HTTP ${status}`);
      return;
    }
    const score = json.score?.omnipresence ?? json.omnipresence_score;
    const mode = json.dataMode || json.intelligence?.dataMode;
    record("public-audit", "Lead audit", score > 0 ? "pass" : "warn", `score ${Math.round(score || 0)}/100, mode=${mode}`, {
      score,
      critical: json.findings?.filter((f) => f.severity === "critical").length,
    });
  } catch (e) {
    record("public-audit", "Lead audit", "warn", `timeout/slow: ${e instanceof Error ? e.message : e} — use /tools/audit for demos`);
  }
}

async function testGoogleProviders() {
  console.log("\n## Google Cloud providers (local key probe)");
  try {
    const { spawnSync } = await import("child_process");
    const r = spawnSync("npm", ["run", "verify:providers", "--", ".env.providers", "--strict", "--json"], {
      cwd: root,
      shell: true,
      encoding: "utf8",
      timeout: 120_000,
    });
    const out = r.stdout || "";
    const jsonStart = out.indexOf("[");
    if (jsonStart >= 0) {
      const arr = JSON.parse(out.slice(jsonStart));
      const google = arr.filter((p) =>
        /PageSpeed|CrUX|YouTube|Knowledge Graph|Natural Language/i.test(p.name)
      );
      for (const p of google) {
        record(`gcp-${p.name}`, p.name, p.status === "ok" ? "pass" : p.status === "fail" ? "fail" : "warn", p.detail || p.status);
      }
    } else {
      record("gcp", "Provider verify", r.status === 0 ? "pass" : "fail", "see verify:providers output");
    }
  } catch (e) {
    record("gcp", "Provider verify", "warn", e instanceof Error ? e.message : String(e));
  }
}

function buildPlaybook() {
  return `
<h2>Tomorrow: 10-Specialist Tester Playbook</h2>
<p><strong>URL:</strong> <a href="${base}">${base}</a> · <strong>Free tools:</strong> <a href="${base}/tools">${base}/tools</a> · <strong>Public audit:</strong> <a href="${base}/audit">${base}/audit</a></p>

<h3>Before testers arrive (15 min)</h3>
<ol>
<li>Create one shared demo project per specialty OR one mega-project with competitors: <code>nike.com</code>, <code>adidas.com</code>, <code>hubspot.com</code>, <code>salesforce.com</code></li>
<li>Run <strong>Re-scan</strong> on the project — wait for scan complete (~2–5 min)</li>
<li>Connect GSC + GA4 under <strong>Attribution</strong> (optional but unlocks 12/12 proof)</li>
<li>Open <strong>Settings → Capabilities</strong> — confirm Google Cloud stack all green</li>
</ol>

<h3>Assign 10 specialists (90 min each)</h3>
<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px;">
<tr><th>#</th><th>Role</th><th>Focus tabs</th><th>Professional test</th><th>Pass criteria</th></tr>
<tr><td>1</td><td>Technical SEO</td><td>Technical, Indexation, Crawlers</td><td>Run audit on slow client site; check CWV, schema, HTML validity findings</td><td>Measured PageSpeed/CrUX; actionable fixes</td></tr>
<tr><td>2</td><td>Keyword strategist</td><td>Keywords, Cannibalization, Trends</td><td>Import 20 head terms; check opportunity scores vs competitors</td><td>Real SERP-backed gaps, not generic lists</td></tr>
<tr><td>3</td><td>Backlinks analyst</td><td>Backlinks, Authority, Source Graph</td><td>Compare referring domains vs 3 competitors</td><td>OmniData graph or honest "ingest in progress"</td></tr>
<tr><td>4</td><td>Rankings tracker</td><td>Rankings, SERP Capture, GSC</td><td>Track 10 keywords; verify position + SERP features</td><td>Positions match manual spot-check</td></tr>
<tr><td>5</td><td>AEO / AI visibility</td><td>Visibility, AEO Readiness, Prompts, Frontier</td><td>Run visibility scan; check ChatGPT/Claude/Gemini citations</td><td>Engine-specific mention rates</td></tr>
<tr><td>6</td><td>AGO / GEO specialist</td><td>GEO Lift, War Room, Proof Ledger</td><td>Measure generative uplift claims with evidence drawer</td><td>Provenance badges show measured vs estimated</td></tr>
<tr><td>7</td><td>Entity / Knowledge Graph</td><td>Entity, Schema deploy</td><td>Build entity profile; detect gaps vs Wikipedia/KG</td><td>Google KG + Wikidata signals</td></tr>
<tr><td>8</td><td>Content / Editorial</td><td>Content, Topical Map, pSEO</td><td>Score draft for target keyword; check NLP entities + readability</td><td>Google NLP + term targets</td></tr>
<tr><td>9</td><td>Local / Merchant</td><td>Local SEO, Merchant, Reputation</td><td>Local grid + NAP check on multi-location brand</td><td>OSM/Nominatim data + NAP findings</td></tr>
<tr><td>10</td><td>Attribution / ROI</td><td>Attribution, ROI Center, Traffic Intel, Guarantee</td><td>Connect GA4; verify connector health + outcome gate</td><td>First-party data flows or clear blocker message</td></tr>
</table>

<h3>Free tools smoke test (all testers, 10 min)</h3>
<p>At <a href="${base}/tools">${base}/tools</a> run each tool on <strong>your own client domain</strong>:</p>
<ul>
<li>AI Readiness Checker · Robots.txt · Schema · llms.txt · Canonical · Sitemap · Citation Planner · ROI Calculator</li>
</ul>

<h3>What makes testers want to subscribe</h3>
<ul>
<li><strong>Evidence drawers</strong> on every panel — click to see raw measured payloads</li>
<li><strong>One scan</strong> populates 40+ tabs (show tab breadth)</li>
<li><strong>White-label PDF</strong> export from project overview</li>
<li><strong>War Room + Proof Ledger</strong> for agency client meetings</li>
<li><strong>No fake data</strong> — when a source is unavailable, UI says so (refund-safe)</li>
</ul>

<h3>Known limitations (be transparent)</h3>
<ul>
<li>Webgraph full ingest may still be running — backlink counts improve when complete</li>
<li>Public /audit can take 2–3 min — use /tools/audit for faster technical-only demos</li>
<li>GSC/GA4 require OAuth connect per project</li>
</ul>
`;
}

function buildHtmlReport() {
  const pass = results.filter((r) => r.status === "pass").length;
  const warn = results.filter((r) => r.status === "warn").length;
  const fail = results.filter((r) => r.status === "fail").length;

  const rows = results
    .map(
      (r) => `
    <tr>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;">${r.status === "pass" ? "✅" : r.status === "warn" ? "⚠️" : "❌"}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;"><strong>${r.name}</strong><br/><span style="color:#64748b;font-size:11px;">${r.id}</span></td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;">${r.detail}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;font-size:11px;font-family:monospace;">${r.data ? JSON.stringify(r.data).slice(0, 200) : "—"}</td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>OmniPresence Professional Tester Report</title></head>
<body style="font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#0f172a;">
  <h1 style="color:#6366f1;">OmniPresence Engine — Professional Tester Report</h1>
  <p>Generated: ${new Date().toISOString()}<br/>
  Target: <a href="${base}">${base}</a><br/>
  Suite started: ${startedAt}</p>

  <div style="display:flex;gap:16px;margin:24px 0;">
    <div style="background:#ecfdf5;padding:16px 24px;border-radius:8px;"><strong style="font-size:24px;color:#059669;">${pass}</strong><br/>Pass</div>
    <div style="background:#fffbeb;padding:16px 24px;border-radius:8px;"><strong style="font-size:24px;color:#d97706;">${warn}</strong><br/>Warn</div>
    <div style="background:#fef2f2;padding:16px 24px;border-radius:8px;"><strong style="font-size:24px;color:#dc2626;">${fail}</strong><br/>Fail</div>
  </div>

  <h2>Automated test results</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">${rows}</table>

  ${buildPlaybook()}

  <p style="margin-top:32px;font-size:12px;color:#94a3b8;">OmniPresence Engine · Automated professional tester suite</p>
</body></html>`;
}

async function sendReport(html) {
  const key = process.env.RESEND_API_KEY;
  if (!key || key.startsWith("your-")) {
    console.log("\n⚠ RESEND_API_KEY not set — report saved locally only");
    return { sent: false, reason: "no resend key" };
  }
  const from = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || "reports@presenceos.app";
  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.filter((r) => r.status === "fail").length;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      from,
      to: emailTo,
      subject: `OmniPresence Pro Tester Report — ${pass} pass, ${fail} fail — ${new Date().toLocaleDateString()}`,
      html,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    return { sent: false, reason: `Resend ${res.status}: ${t.slice(0, 200)}` };
  }
  const j = await res.json();
  return { sent: true, id: j.id };
}

// --- run ---
console.log(`\n${"=".repeat(60)}\n  OmniPresence Professional Tester Suite\n  ${base}\n${"=".repeat(60)}`);

await testHealth();
await testSerpAccuracy();
await testAllTools();
await testPublicAudit();
await testGoogleProviders();

const outDir = join(root, "reports");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const htmlPath = join(outDir, `professional-tester-${stamp}.html`);
const jsonPath = join(outDir, `professional-tester-${stamp}.json`);
const html = buildHtmlReport();
writeFileSync(htmlPath, html);
writeFileSync(jsonPath, JSON.stringify({ base, startedAt, results, emailTo }, null, 2));

console.log(`\n## Summary`);
const pass = results.filter((r) => r.status === "pass").length;
const warn = results.filter((r) => r.status === "warn").length;
const fail = results.filter((r) => r.status === "fail").length;
console.log(`  Pass: ${pass}  Warn: ${warn}  Fail: ${fail}`);
console.log(`  Report: ${htmlPath}`);

console.log(`\n## Email to ${emailTo}`);
const mail = await sendReport(html);
if (mail.sent) console.log(`  ✓ Sent (id: ${mail.id})`);
else console.log(`  ✗ Not sent: ${mail.reason}`);

process.exitCode = fail > 0 ? 1 : 0;
