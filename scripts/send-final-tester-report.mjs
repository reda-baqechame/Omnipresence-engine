#!/usr/bin/env node
/**
 * Merge all QA reports and email comprehensive final dossier to operator inbox.
 */
import { readFileSync, existsSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const emailTo = process.argv.includes("--email")
  ? process.argv[process.argv.indexOf("--email") + 1]
  : "redabaq58@gmail.com";
const base = "https://omnipresence-engine.vercel.app";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(join(root, ".env.providers"));

function latest(prefix, ext) {
  const dir = join(root, "reports");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
    .sort()
    .reverse();
  return files[0] ? join(dir, files[0]) : null;
}

const proJson = latest("professional-tester-", ".json");
const panelJson = latest("panel-qa-", ".json");
const browserJson = latest("browser-qa-", ".json");

const sections = [];
let totalPass = 0;
let totalWarn = 0;
let totalFail = 0;

function ingest(name, path) {
  if (!path || !existsSync(path)) return `<h2>${name}</h2><p>No report found.</p>`;
  const data = JSON.parse(readFileSync(path, "utf8"));
  const results = data.results || [];
  const pass = results.filter((r) => r.status === "pass").length;
  const warn = results.filter((r) => r.status === "warn").length;
  const fail = results.filter((r) => r.status === "fail").length;
  totalPass += pass;
  totalWarn += warn;
  totalFail += fail;
  const rows = results
    .map(
      (r) =>
        `<tr><td>${r.status === "pass" ? "✅" : r.status === "warn" ? "⚠️" : "❌"}</td><td>${r.name || r.id}</td><td>${r.detail || ""}</td><td style="font-size:11px">${r.takeaway || (r.data ? String(r.data).slice(0, 100) : "—")}</td></tr>`
    )
    .join("");
  return `<h2>${name}</h2><p>${pass} pass · ${warn} warn · ${fail} fail · <code>${path.split(/[/\\]/).pop()}</code></p>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:12px"><tr><th></th><th>Test</th><th>Detail</th><th>Notes</th></tr>${rows}</table>`;
}

const playbook = `
<h2>Tomorrow: 10 Specialist Session (each creates own account)</h2>
<ol>
<li><a href="${base}/signup">Sign up</a> — instant access (no email confirmation wait)</li>
<li><strong>New Project</strong> → your client domain + 2–3 competitors + industry</li>
<li>Overview → <strong>Re-scan</strong> → wait 2–8 min (do not leave page)</li>
<li>Settings → Capabilities — all Google stack green</li>
<li>Work assigned specialty tabs 45–90 min</li>
<li>Finish at <a href="${base}/tools">/tools</a> — AI Readiness on a second domain</li>
</ol>
<table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:12px">
<tr><th>#</th><th>Role</th><th>Tabs</th></tr>
<tr><td>1</td><td>Technical SEO</td><td>Technical, Indexation, Crawlers</td></tr>
<tr><td>2</td><td>Keywords</td><td>Keywords, Cannibalization, Trends</td></tr>
<tr><td>3</td><td>Backlinks</td><td>Backlinks, Authority, Source Graph</td></tr>
<tr><td>4</td><td>Rankings</td><td>Rankings, SERP Capture, GSC</td></tr>
<tr><td>5</td><td>AEO</td><td>Visibility, AEO Readiness, Prompts, Frontier</td></tr>
<tr><td>6</td><td>GEO/AGO</td><td>GEO Lift, War Room, Proof Ledger</td></tr>
<tr><td>7</td><td>Entity</td><td>Entity</td></tr>
<tr><td>8</td><td>Content</td><td>Content, Topical, pSEO</td></tr>
<tr><td>9</td><td>Local</td><td>Local SEO, Merchant, Reputation</td></tr>
<tr><td>10</td><td>Attribution</td><td>Attribution, ROI, Traffic, Guarantee</td></tr>
</table>
<h3>Fixes shipped (2026-07-03)</h3>
<ul>
<li><strong>Registration fixed</strong> — signup uses server-side <code>/api/auth/register</code> (instant account + org)</li>
<li><strong>Auth hardened</strong> — rate limits on register/setup-org, email validation, rollback on partial signup failure</li>
<li>Supabase auth configured; DB migration 0010 applied</li>
<li>Public lead audit — no more 504; schema HTML fallback</li>
<li>Google Cloud stack — PageSpeed, CrUX, YouTube, KG, NLP all ON</li>
<li>Webgraph full ingest re-triggered on 20GB Railway volume (~90–120 min)</li>
</ul>
<h3>Known limitations (say upfront)</h3>
<ul>
<li>First Re-scan may take up to 8 min for large brands — data fills progressively</li>
<li>Webgraph ingest in progress as of this report — backlink graph fills when complete</li>
<li>GSC/GA4 optional — OAuth per project</li>
<li>Public /audit is heavier than /tools/audit for quick demos</li>
</ul>
`;

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>OmniPresence Final Tester Dossier</title></head>
<body style="font-family:system-ui,sans-serif;max-width:1000px;margin:0 auto;padding:24px;color:#0f172a">
<h1 style="color:#6366f1">OmniPresence — Final Professional Tester Dossier</h1>
<p>Generated ${new Date().toISOString()}<br/>Production: <a href="${base}">${base}</a></p>
<div style="display:flex;gap:16px;margin:20px 0">
<div style="background:#ecfdf5;padding:16px 24px;border-radius:8px"><b style="font-size:28px;color:#059669">${totalPass}</b><br/>Total Pass</div>
<div style="background:#fffbeb;padding:16px 24px;border-radius:8px"><b style="font-size:28px;color:#d97706">${totalWarn}</b><br/>Total Warn</div>
<div style="background:#fef2f2;padding:16px 24px;border-radius:8px"><b style="font-size:28px;color:#dc2626">${totalFail}</b><br/>Total Fail</div>
</div>
${ingest("1. Public API + Free Tools + Health", proJson)}
${ingest("2. Authenticated Panel APIs (46-tab backend)", panelJson)}
${ingest("3. Browser Page Load QA", browserJson)}
${playbook}
<p style="margin-top:32px;font-size:12px;color:#94a3b8">OmniPresence Engine · Full tester readiness dossier</p>
</body></html>`;

// Recompute totals after building (ingest mutates during template - need fix)
totalPass = 0;
totalWarn = 0;
totalFail = 0;
for (const p of [proJson, panelJson, browserJson]) {
  if (p && existsSync(p)) {
    const results = JSON.parse(readFileSync(p, "utf8")).results || [];
    totalPass += results.filter((r) => r.status === "pass").length;
    totalWarn += results.filter((r) => r.status === "warn").length;
    totalFail += results.filter((r) => r.status === "fail").length;
  }
}

const finalPath = join(root, "reports", `final-tester-dossier-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.html`);
writeFileSync(finalPath, html.replace(
  `<b style="font-size:28px;color:#059669">${0}</b>`,
  `<b style="font-size:28px;color:#059669">${totalPass}</b>`
).replace(
  /Total Pass<\/div>\s*<div[^>]+><b style="font-size:28px;color:#d97706">\d+/,
  `Total Pass</div><div style="background:#fffbeb;padding:16px 24px;border-radius:8px"><b style="font-size:28px;color:#d97706">${totalWarn}`
));

// Simpler: rebuild html with correct totals
const htmlFinal = html.replace(
  /<b style="font-size:28px;color:#059669">\d+<\/b><br\/>Total Pass/,
  `<b style="font-size:28px;color:#059669">${totalPass}</b><br/>Total Pass`
).replace(
  /<b style="font-size:28px;color:#d97706">\d+<\/b><br\/>Total Warn/,
  `<b style="font-size:28px;color:#d97706">${totalWarn}</b><br/>Total Warn`
).replace(
  /<b style="font-size:28px;color:#dc2626">\d+<\/b><br\/>Total Fail/,
  `<b style="font-size:28px;color:#dc2626">${totalFail}</b><br/>Total Fail`
);
writeFileSync(finalPath, htmlFinal);

const key = process.env.RESEND_API_KEY;
if (!key || key.startsWith("your-")) {
  console.log("No RESEND_API_KEY — saved locally:", finalPath);
  process.exit(0);
}

const from = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || "reports@presenceos.app";
const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from,
    to: emailTo,
    subject: `OmniPresence FINAL Tester Dossier — ${totalPass} pass, ${totalFail} fail — ${new Date().toLocaleDateString()}`,
    html: htmlFinal,
  }),
});
if (!res.ok) {
  console.error("Resend failed:", await res.text());
  process.exit(1);
}
const j = await res.json();
console.log(`✓ Final dossier emailed to ${emailTo} (id: ${j.id})`);
console.log(`  Local: ${finalPath}`);
console.log(`  Totals: ${totalPass} pass, ${totalWarn} warn, ${totalFail} fail`);
