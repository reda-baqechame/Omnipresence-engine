/**
 * Agency-grade HTML + print-CSS template for Deep Intelligence Reports.
 * Single source of truth for web view AND Playwright PDF rendering.
 */
import type { IntelligenceReport, IntelligenceReportBranding } from "@/types/intelligence-report";
import { escapeHtml, sanitizeHexColor } from "@/lib/security/escape-html";
import { formatRate } from "@/lib/engines/visibility-scope";

function e(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return "";
  return escapeHtml(String(v));
}

function qualityBadge(q: string): string {
  const labels: Record<string, string> = {
    measured: "Live data",
    estimated_proxy: "Estimated proxy",
    not_available: "Not available",
  };
  return `<span class="badge badge-${q}">${e(labels[q] || q)}</span>`;
}

function barChart(items: Array<{ label: string; value: number; max?: number }>, color: string): string {
  const max = Math.max(...items.map((i) => i.max ?? i.value), 1);
  return items
    .map((item) => {
      const pct = Math.round((item.value / max) * 100);
      return `<div class="bar-row"><span class="bar-label">${e(item.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div><span class="bar-val">${e(item.value)}</span></div>`;
    })
    .join("");
}

function sectionOrSkip(id: string, title: string, available: boolean, body: string): string {
  if (!available) return "";
  return `<section id="${id}" class="report-section"><h2>${e(title)}</h2>${body}</section>`;
}

export function generateIntelligenceReportHTML(
  report: IntelligenceReport,
  branding?: IntelligenceReportBranding,
  narrative?: Partial<Record<string, string>>
): string {
  const brand = e(branding?.name || "PresenceOS");
  const color = sanitizeHexColor(branding?.color || "#6366f1");
  const logo = branding?.logoUrl
    ? `<img src="${e(branding.logoUrl)}" alt="${brand}" class="logo" />`
    : "";
  const date = new Date(report.meta.generatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const exec = report.executive;
  const vis = report.visibility.snapshot;

  const tocItems = [
    ["executive", "Executive Summary"],
    ["competitive", "Market & Competitive Intelligence"],
    ["visibility", "AI Visibility & Share of Voice"],
    ["keywords", "Keyword & Content Strategy"],
    ["backlinks", "Backlink & Authority"],
    ["technical", "Technical & Performance"],
    ["local", "Local & Entity"],
    ["community", "Community & Reputation"],
    ["roi", "ROI & Attribution"],
    ["roadmap", "90-Day Roadmap"],
    ["proof", "Proof & Guarantee"],
    ["methodology", "Methodology & Sources"],
  ]
    .filter(([id]) => {
      const key = id as keyof IntelligenceReport;
      const sec = report[key];
      return sec && typeof sec === "object" && "available" in sec && (sec as { available: boolean }).available;
    })
    .map(([id, label]) => `<li><a href="#${id}">${e(label)}</a></li>`)
    .join("");

  const subScoreBars = barChart(
    Object.entries(exec.subScores).map(([label, value]) => ({ label, value: value as number, max: 100 })),
    color
  );

  const competitiveMatrix =
    report.competitive.available && report.competitive.target
      ? `<table class="data-table"><thead><tr><th>Domain</th><th>Popularity tier</th><th>Popularity</th><th>Authority</th></tr></thead><tbody>
        <tr><td><strong>${e(report.meta.domain)}</strong> (you)</td>
          <td>${report.competitive.target.popularity.tier}/10</td>
          <td>${report.competitive.target.popularity.score}/100</td>
          <td>${report.competitive.target.authority.rating}</td></tr>
        ${report.competitive.competitors
          .map(
            (c) =>
              `<tr><td>${e(c.domain)}</td><td>${c.popularity.tier}/10</td><td>${c.popularity.score}/100</td><td>${c.authority.rating}</td></tr>`
          )
          .join("")}
        </tbody></table>
        <p class="note">Popularity scores are estimated proxies — not visit counts. ${qualityBadge("estimated_proxy")}</p>`
      : `<p class="muted">Competitive data not yet available. Run a scan with competitors configured.</p>`;

  const visibilityBody = report.visibility.available
    ? `<div class="metrics-grid">
        <div class="metric"><span class="metric-val">${formatRate(vis.metrics.mentionRate, vis.ratesReliable)}</span><span class="metric-label">Mention rate</span></div>
        <div class="metric"><span class="metric-val">${formatRate(vis.metrics.citationRate, vis.ratesReliable)}</span><span class="metric-label">Citation rate</span></div>
        <div class="metric"><span class="metric-val">${formatRate(vis.metrics.winRate, vis.ratesReliable)}</span><span class="metric-label">Win rate</span></div>
        <div class="metric"><span class="metric-val">${vis.groundedCount}/${vis.attempted}</span><span class="metric-label">Grounded probes</span></div>
      </div>
      ${vis.reliabilityNote ? `<p class="note">${e(vis.reliabilityNote)}</p>` : ""}
      ${narrative?.visibility ? `<div class="narrative">${narrative.visibility}</div>` : ""}
      ${
        report.visibility.topWinPrompts.length
          ? `<h3>Prompts where competitors win</h3><table class="data-table"><thead><tr><th>Prompt</th><th>Engine</th><th>Winner</th></tr></thead><tbody>${report.visibility.topWinPrompts
              .slice(0, 10)
              .map(
                (p) =>
                  `<tr><td>${e(p.prompt)}</td><td>${e(p.engine)}</td><td>${e(p.winner)}</td></tr>`
              )
              .join("")}</tbody></table>`
          : ""
      }`
    : `<p class="muted">No visibility probes yet.</p>`;

  const keywordsBody = report.keywords.available
    ? `${narrative?.keywords ? `<div class="narrative">${narrative.keywords}</div>` : ""}
      <h3>Top keyword opportunities</h3>
      <table class="data-table"><thead><tr><th>Keyword</th><th>Volume</th><th>Difficulty</th><th>Quality</th></tr></thead><tbody>
      ${report.keywords.opportunities
        .slice(0, 15)
        .map(
          (k) =>
            `<tr><td>${e(k.keyword)}</td><td>${k.volume ?? "—"}</td><td>${k.difficulty ?? "—"}</td><td>${qualityBadge(k.dataQuality)}</td></tr>`
        )
        .join("")}
      </table>
      ${
        report.keywords.strikingDistance.length
          ? `<h3>Striking distance (positions 4–20)</h3><ul>${report.keywords.strikingDistance
              .map((k) => `<li><strong>${e(k.keyword)}</strong> — position ${k.position}${k.url ? ` · ${e(k.url)}` : ""}</li>`)
              .join("")}</ul>`
          : ""
      }`
    : `<p class="muted">Keyword intelligence pending — run keyword research.</p>`;

  const backlinksBody = report.backlinks.available
    ? `<p><strong>${report.backlinks.referringDomains}</strong> referring domains detected. Authority rating: <strong>${report.backlinks.authorityRating ?? "—"}</strong></p>
      <table class="data-table"><thead><tr><th>Referring domain</th></tr></thead><tbody>
      ${report.backlinks.topReferrers.map((b) => `<tr><td>${e(b.domain)}</td></tr>`).join("")}
      </tbody></table>`
    : `<p class="muted">Backlink data not available.</p>`;

  const technicalBody = report.technical.available
    ? `<p>${report.technical.criticalCount} critical · ${report.technical.highCount} high severity issues</p>
      ${
        report.technical.cwv
          ? `<p>Core Web Vitals: LCP ${report.technical.cwv.lcp ?? "—"}ms · CLS ${report.technical.cwv.cls ?? "—"} · INP ${report.technical.cwv.inp ?? "—"}ms ${qualityBadge(report.technical.cwv.dataQuality)}</p>`
          : ""
      }
      <ul>${report.technical.findings
        .slice(0, 12)
        .map((f) => `<li><span class="sev-${e(f.severity)}">${e(f.severity)}</span> ${e(f.title)}</li>`)
        .join("")}</ul>`
    : `<p class="muted">No technical audit data.</p>`;

  const localBody =
    report.local.available || report.entity.available
      ? `<h3>Local presence</h3><p>${report.local.listingsFound} verified listings. ${report.local.gaps.length ? `Gaps: ${report.local.gaps.map((g) => e(g)).join("; ")}` : ""}</p>
       <h3>Entity graph</h3><p>Knowledge panel ready: ${report.entity.knowledgeGraph ? "Yes" : "No"} · ${report.entity.sameAsCount} sameAs links</p>
       ${report.entity.gaps.length ? `<ul>${report.entity.gaps.map((g) => `<li>${e(g)}</li>`).join("")}</ul>` : ""}`
      : `<p class="muted">Local/entity data not configured.</p>`;

  const communityBody = report.community.available
    ? `<table class="data-table"><thead><tr><th>Platform</th><th>Mention</th></tr></thead><tbody>
      ${report.community.mentions.map((m) => `<tr><td>${e(m.platform)}</td><td>${m.url ? `<a href="${e(m.url)}">${e(m.title)}</a>` : e(m.title)}</td></tr>`).join("")}
      </tbody></table>`
    : `<p class="muted">No community mentions tracked yet.</p>`;

  const roiBody = report.roi.available
    ? `<p>Estimated organic ads replacement value: <strong>$${Math.round(report.roi.adsEquivalent || 0).toLocaleString()}/mo</strong>
       (${Math.round((report.roi.replacementRatio || 0) * 100)}% of stated ad spend). CPC source: ${e(report.roi.cpcSource)}.</p>`
    : `<p class="muted">Connect attribution (GA4/GSC) for ROI analysis.</p>`;

  const roadmapBody = report.roadmap.available
    ? `<ol>${report.roadmap.items
        .map(
          (item) =>
            `<li><strong>${e(item.title)}</strong>${item.description ? ` — ${e(item.description)}` : ""} <em>(week ${item.week})</em></li>`
        )
        .join("")}</ol>`
    : `<p class="muted">Roadmap not generated yet.</p>`;

  const proofBody = report.proof.available
    ? `${report.proof.proofHtml || ""}
       <p>${report.proof.ledgerActions} ledger actions · ${report.proof.deliverablesMet}/${report.proof.deliverablesTotal} deliverables completed</p>`
    : `<p class="muted">Proof ledger empty — baseline will populate after first scan.</p>`;

  const methodologyBody = `<p>This report aggregates live measurements and labeled estimates from the following sources:</p>
    <table class="data-table"><thead><tr><th>Source</th><th>License</th></tr></thead><tbody>
    ${report.methodology.attributions
      .map((a) => `<tr><td>${a.url ? `<a href="${e(a.url)}">${e(a.source)}</a>` : e(a.source)}</td><td>${e(a.license || "—")}</td></tr>`)
      .join("")}
    </tbody></table>
    <ul class="disclaimers">${report.methodology.disclaimers.map((d) => `<li>${e(d)}</li>`).join("")}</ul>`;

  const coverageGrid = report.coverageItems.length
    ? `<div class="coverage-grid">${report.coverageItems
        .map(
          (c) =>
            `<div class="coverage-item ${c.is_present ? "present" : "missing"}"><span>${e(c.surface)}</span><span>${c.is_present ? "✓" : "✗"}</span></div>`
        )
        .join("")}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${brand} — Deep Intelligence Report — ${e(report.meta.brandName)}</title>
<style>
  :root { --brand: ${color}; --text: #0f172a; --muted: #64748b; --border: #e2e8f0; --bg: #fff; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: var(--text); background: var(--bg); line-height: 1.6; }
  .cover { min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 4rem 2rem; page-break-after: always; background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%); }
  .cover .logo { max-height: 64px; margin-bottom: 2rem; }
  .cover h1 { font-size: 2.5rem; font-weight: 700; color: var(--brand); margin-bottom: 0.5rem; }
  .cover .subtitle { font-size: 1.25rem; color: var(--muted); margin-bottom: 2rem; }
  .cover .score-hero { font-size: 5rem; font-weight: 800; color: var(--brand); line-height: 1; }
  .cover .score-label { font-size: 1.1rem; color: var(--muted); margin-top: 0.5rem; }
  .cover .meta { margin-top: 3rem; font-size: 0.9rem; color: var(--muted); }
  .container { max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
  .toc { page-break-after: always; padding: 3rem 0; }
  .toc h2 { font-size: 1.5rem; margin-bottom: 1.5rem; color: var(--brand); }
  .toc ol { list-style: none; counter-reset: toc; }
  .toc li { counter-increment: toc; padding: 0.5rem 0; border-bottom: 1px solid var(--border); }
  .toc li::before { content: counter(toc) ". "; color: var(--brand); font-weight: 600; }
  .toc a { color: var(--text); text-decoration: none; }
  .report-section { page-break-inside: avoid; margin-bottom: 3rem; padding-top: 1rem; border-top: 2px solid var(--border); }
  .report-section h2 { font-size: 1.4rem; color: var(--brand); margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border); }
  .report-section h3 { font-size: 1.1rem; margin: 1.25rem 0 0.75rem; }
  .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin: 1rem 0; }
  .metric { text-align: center; padding: 1rem; background: #f8fafc; border-radius: 8px; }
  .metric-val { display: block; font-size: 1.75rem; font-weight: 700; color: var(--brand); }
  .metric-label { font-size: 0.8rem; color: var(--muted); }
  .data-table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.9rem; }
  .data-table th, .data-table td { padding: 0.6rem 0.75rem; border: 1px solid var(--border); text-align: left; }
  .data-table th { background: #f1f5f9; font-weight: 600; }
  .bar-row { display: flex; align-items: center; gap: 0.75rem; margin: 0.4rem 0; }
  .bar-label { width: 100px; font-size: 0.85rem; }
  .bar-track { flex: 1; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; }
  .bar-val { width: 36px; text-align: right; font-size: 0.85rem; font-weight: 600; }
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 500; }
  .badge-measured { background: #dcfce7; color: #166534; }
  .badge-estimated_proxy { background: #fef9c3; color: #854d0e; }
  .badge-not_available { background: #f1f5f9; color: #64748b; }
  .note, .muted { color: var(--muted); font-size: 0.9rem; margin: 0.75rem 0; }
  .narrative { background: #f8fafc; border-left: 4px solid var(--brand); padding: 1rem 1.25rem; margin: 1rem 0; font-size: 0.95rem; }
  .coverage-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin: 1rem 0; }
  .coverage-item { display: flex; justify-content: space-between; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.85rem; }
  .coverage-item.present { background: #dcfce7; }
  .coverage-item.missing { background: #fee2e2; }
  .sev-critical { color: #dc2626; font-weight: 600; text-transform: uppercase; font-size: 0.75rem; }
  .sev-high { color: #ea580c; font-weight: 600; text-transform: uppercase; font-size: 0.75rem; }
  .footer { text-align: center; padding: 2rem; color: var(--muted); font-size: 0.85rem; border-top: 1px solid var(--border); margin-top: 3rem; }
  .disclaimers { margin-top: 1rem; padding-left: 1.25rem; color: var(--muted); font-size: 0.85rem; }
  @media print {
    .cover { min-height: auto; padding: 2rem; }
    .report-section { page-break-inside: avoid; }
    a { color: inherit; text-decoration: none; }
  }
</style>
</head>
<body>
  <div class="cover">
    ${logo}
    <h1>${brand}</h1>
    <p class="subtitle">Deep Intelligence Report</p>
    <p style="font-size:1.5rem;font-weight:600;margin-bottom:1rem">${e(report.meta.brandName)}</p>
    <p style="color:var(--muted);margin-bottom:2rem">${e(report.meta.domain)}</p>
    <div class="score-hero">${exec.omnipresenceScore}</div>
    <div class="score-label">${e(exec.scoreLabel)} OmniPresence Score</div>
    ${exec.scoreDelta !== undefined ? `<p style="margin-top:1rem;color:${exec.scoreDelta >= 0 ? "#16a34a" : "#dc2626"}">${exec.scoreDelta >= 0 ? "+" : ""}${exec.scoreDelta} vs previous scan</p>` : ""}
    <p class="meta">Generated ${e(date)} · Confidential</p>
  </div>

  <div class="container">
    <nav class="toc"><h2>Table of Contents</h2><ol>${tocItems}</ol></nav>

    ${sectionOrSkip(
      "executive",
      "Executive Summary",
      exec.available,
      `${narrative?.executive ? `<div class="narrative">${narrative.executive}</div>` : ""}
       <ul>${exec.keyFindings.map((f) => `<li>${e(f)}</li>`).join("")}</ul>
       <h3>Score breakdown</h3>${subScoreBars}
       <h3>Platform coverage</h3>${coverageGrid}`
    )}

    ${sectionOrSkip("competitive", "Market & Competitive Intelligence", report.competitive.available, competitiveMatrix)}
    ${sectionOrSkip("visibility", "AI Visibility & Share of Voice", report.visibility.available, visibilityBody)}
    ${sectionOrSkip("keywords", "Keyword & Content Strategy", report.keywords.available, keywordsBody)}
    ${sectionOrSkip("backlinks", "Backlink & Authority", report.backlinks.available, backlinksBody)}
    ${sectionOrSkip("technical", "Technical & Performance", report.technical.available, technicalBody)}
    ${sectionOrSkip("local", "Local & Entity Presence", report.local.available || report.entity.available, localBody)}
    ${sectionOrSkip("community", "Community & Reputation", report.community.available, communityBody)}
    ${sectionOrSkip("roi", "ROI & Attribution", report.roi.available, roiBody)}
    ${sectionOrSkip("roadmap", "90-Day Execution Roadmap", report.roadmap.available, roadmapBody)}
    ${sectionOrSkip("proof", "Proof & Guarantee", report.proof.available, proofBody)}
    ${sectionOrSkip("methodology", "Methodology & Data Sources", true, methodologyBody)}

    <div class="footer">
      <p>${brand}${branding?.domain ? ` · ${e(branding.domain)}` : ""}</p>
      <p>Deep Intelligence Report · ${e(date)} · All popularity/traffic indices are relative proxies, not visit counts.</p>
    </div>
  </div>
</body>
</html>`;
}
