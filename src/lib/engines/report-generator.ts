import type {
  Project,
  OmniPresenceScore,
  TechnicalFinding,
  CoverageItem,
  AuthorityOpportunity,
  RoadmapItem,
  VisibilityResult,
} from "@/types/database";
import { getScoreLabel } from "@/lib/scoring/omnipresence";
import { calculateVisibilityMetrics } from "@/lib/engines/visibility-scanner";
import { calculateShareOfVoice, calculateShareOfVoiceByEngine, type ShareOfVoiceResult } from "@/lib/engines/share-of-voice";
import { escapeHtml, sanitizeHexColor } from "@/lib/security/escape-html";
import { getSubScoreAvailability } from "@/lib/scoring/subscore-availability";

function e(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  return escapeHtml(String(value));
}

export interface ReportData {
  project: Project;
  score: OmniPresenceScore;
  previousScore?: OmniPresenceScore;
  technicalFindings: TechnicalFinding[];
  coverageItems: CoverageItem[];
  authorityOpportunities: AuthorityOpportunity[];
  roadmapItems: RoadmapItem[];
  visibilityResults: VisibilityResult[];
  /** Fast-upside keywords already ranking positions 4-20 (real rank data). */
  strikingKeywords?: Array<{ keyword: string; position: number; url?: string }>;
  generatedAt: string;
  /** Pre-rendered Before/After proof section (from proof-report.renderProofHTML). */
  proofHtml?: string;
  /** Verifiable receipts behind this run's AI numbers (Master Plan v4 Phase 1):
   * each links to the public /verify/{id} page where the client can
   * independently recompute the hash chain — no login, no trust required. */
  receipts?: Array<{
    id: string;
    prompt: string;
    surface: string | null;
    engine: string;
    captured_at: string;
    chained: boolean;
  }>;
  /** Absolute origin for /verify links in exported HTML/PDF. */
  verifyBaseUrl?: string;
  adsEquivalent?: {
    totalOrganicValue: number;
    replacementRatio: number;
    statedAdSpend: number;
    /** "real" = Google Ads Keyword Planner CPC; "industry_estimate" = static default. */
    cpcSource: "real" | "industry_estimate";
  };
}

/** Label -> score-dimension-key map shared by every renderer of the standard report's scorecard (HTML + PDF). */
export const SUB_SCORE_LABEL_MAP = {
  "AI Visibility": "ai_visibility",
  Search: "search_visibility",
  Local: "local_visibility",
  Social: "social_presence",
  Directories: "directory_coverage",
  Authority: "authority_mentions",
  Technical: "technical_readiness",
  Conversion: "conversion_readiness",
} as const;

export interface MethodologyRow {
  metric: string;
  method: string;
}

/**
 * Pure data for the "Methodology & Data Sources" appendix — extracted so the
 * HTML report (methodologyAppendixHTML below) and the downloadable PDF
 * (report-pdf-document.tsx) render the identical, data-driven methodology
 * text from one source of truth instead of two hand-maintained copies.
 */
export function buildMethodologyRows(
  data: ReportData,
  ctx: { measuredPct: number; maxSamples: number }
): MethodologyRow[] {
  const rows: MethodologyRow[] = [
    {
      metric: "OmniPresence Score",
      method:
        "Weighted composite across 8 dimensions. A dimension with no live signal this run is excluded from the composite and shown as \u2014, never scored as 0.",
    },
    {
      metric: "AI Visibility (mention/citation/win rate)",
      method: `Computed only over AI engines this run actually probed (${ctx.measuredPct}% of prompts measured live)${ctx.maxSamples > 1 ? `; each prompt sampled up to ${ctx.maxSamples}\u00d7 and majority-voted to control for AI response volatility` : ""}. Unmeasured engines are excluded, not counted as a miss.`,
    },
    {
      metric: "Mention rate confidence interval",
      method: "Wilson score interval over the measured probe sample \u2014 a statistical bound, not a simulated range.",
    },
    {
      metric: "AI Share of Voice",
      method: "Prominence-weighted across measured AI answers: being named the top pick counts more than a passing mention, matching how buyers actually read AI answers.",
    },
    {
      metric: "Platform coverage",
      method: "Presence checked per surface (directory, social, local, review) via live lookups where a connector exists; unresolvable surfaces are marked missing, not silently dropped.",
    },
  ];
  if (data.adsEquivalent) {
    rows.push({
      metric: "Paid ads replacement value",
      method:
        data.adsEquivalent.cpcSource === "real"
          ? "Organic + AI-referral sessions (measured via GA4) \u00d7 your real keyword CPC (Google Ads Keyword Planner)."
          : "Organic + AI-referral sessions (measured via GA4) \u00d7 an industry-average CPC estimate \u2014 connect DataForSEO for your exact CPC.",
    });
  }
  rows.push({
    metric: "Authority opportunities & roadmap",
    method: "Prioritized heuristics for outreach/execution planning \u2014 projected impact, not a financial guarantee.",
  });
  return rows;
}

export interface ReportViewModel {
  subScoreAvailable: Record<string, boolean>;
  visibility: ReturnType<typeof calculateVisibilityMetrics>;
  sov: ShareOfVoiceResult;
  sovByEngine: ReturnType<typeof calculateShareOfVoiceByEngine>;
  criticalFindings: TechnicalFinding[];
  missingCoverage: CoverageItem[];
  topOpportunities: AuthorityOpportunity[];
  competitorWinPrompts: Array<{ prompt: string; engine: string; winners: string[] }>;
  socialGaps: CoverageItem[];
  directoryGaps: CoverageItem[];
  localGaps: CoverageItem[];
  reviewGaps: CoverageItem[];
  measuredPct: number;
  maxSamples: number;
  aiProvenance: "Live" | "Partial" | "Unavailable";
  methodologyRows: MethodologyRow[];
}

/**
 * Single source of truth for every derived metric the standard report
 * renders — computed once here so the HTML renderer and the downloadable
 * PDF renderer (report-pdf-document.tsx) show the SAME numbers, honesty
 * rules, and methodology, rather than the PDF maintaining its own thinner,
 * independently-computed copy (the gap a hostile audit found: the PDF a
 * customer actually downloads didn't include AI visibility, share-of-voice,
 * ads-replacement, or the methodology appendix at all).
 */
export function buildReportViewModel(data: ReportData): ReportViewModel {
  const subScoreAvailable = getSubScoreAvailability(data.score, SUB_SCORE_LABEL_MAP);
  const visibility = calculateVisibilityMetrics(data.visibilityResults);
  const sov = calculateShareOfVoice(data.visibilityResults, data.project.name, data.project.competitors || []);
  const sovByEngine = calculateShareOfVoiceByEngine(
    data.visibilityResults,
    data.project.name,
    data.project.competitors || []
  );
  const criticalFindings = data.technicalFindings.filter((f) => f.severity === "critical" || f.severity === "high");
  const missingCoverage = data.coverageItems.filter((c) => !c.is_present);
  const topOpportunities = data.authorityOpportunities.slice(0, 10);

  const competitorWinPrompts = data.visibilityResults
    .filter((r) => r.measurement_mode !== "unavailable" && !r.brand_mentioned)
    .map((r) => {
      const winners = Object.entries(r.competitor_mentions || {})
        .filter(([, present]) => present)
        .map(([name]) => name);
      return winners.length ? { prompt: r.prompt_text, engine: String(r.engine), winners } : null;
    })
    .filter((x): x is { prompt: string; engine: string; winners: string[] } => x !== null)
    .slice(0, 10);

  const gapsIn = (surfaces: string[]) => missingCoverage.filter((c) => surfaces.includes(String(c.surface)));
  const socialGaps = gapsIn(["linkedin", "x_twitter", "facebook", "instagram", "tiktok", "youtube", "reddit", "quora"]);
  const directoryGaps = gapsIn(["directory", "other"]);
  const localGaps = gapsIn(["google_business", "bing_places", "apple_business"]);
  const reviewGaps = gapsIn(["g2", "capterra", "trustpilot", "yelp", "review_site"]);

  const measuredPct = Math.round((visibility.measuredRate ?? 0) * 100);
  const aiProvenance: "Live" | "Partial" | "Unavailable" =
    measuredPct >= 60 ? "Live" : measuredPct > 0 ? "Partial" : "Unavailable";

  const maxSamples = data.visibilityResults.reduce((m, r) => Math.max(m, r.sample_count ?? 1), 1);

  const methodologyRows = buildMethodologyRows(data, { measuredPct, maxSamples });

  return {
    subScoreAvailable,
    visibility,
    sov,
    sovByEngine,
    criticalFindings,
    missingCoverage,
    topOpportunities,
    competitorWinPrompts,
    socialGaps,
    directoryGaps,
    localGaps,
    reviewGaps,
    measuredPct,
    maxSamples,
    aiProvenance,
    methodologyRows,
  };
}

export function generateReportHTML(data: ReportData, whiteLabel?: { name: string; color: string }): string {
  const brand = e(whiteLabel?.name || "PresenceOS");
  const color = sanitizeHexColor(whiteLabel?.color);
  const scoreLabel = getScoreLabel(data.score.omnipresence_score);
  const {
    subScoreAvailable,
    visibility,
    sov,
    sovByEngine,
    criticalFindings,
    missingCoverage,
    topOpportunities,
    competitorWinPrompts,
    socialGaps,
    directoryGaps,
    localGaps,
    reviewGaps,
    measuredPct,
    maxSamples,
    aiProvenance,
  } = buildReportViewModel(data);
  const ENGINE_LABELS: Record<string, string> = {
    chatgpt: "ChatGPT",
    claude: "Claude",
    gemini: "Gemini",
    perplexity: "Perplexity",
    google_ai_overview: "Google AI Overview",
    google_organic: "Google Search",
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>OmniPresence Report — ${e(data.project.name)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a2e; line-height: 1.6; }
    .container { max-width: 800px; margin: 0 auto; padding: 40px 20px; }
    .header { text-align: center; margin-bottom: 40px; border-bottom: 3px solid ${color}; padding-bottom: 20px; }
    .header h1 { font-size: 28px; color: ${color}; }
    .header p { color: #666; margin-top: 8px; }
    .score-hero { text-align: center; background: linear-gradient(135deg, ${color}15, ${color}05); border-radius: 16px; padding: 32px; margin-bottom: 32px; }
    .score-number { font-size: 72px; font-weight: 800; color: ${color}; }
    .score-label { font-size: 18px; color: #666; margin-top: 4px; }
    .sub-scores { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; }
    .sub-score { background: #f8f9fa; border-radius: 8px; padding: 12px; text-align: center; }
    .sub-score .value { font-size: 24px; font-weight: 700; color: ${color}; }
    .sub-score .value-nodata { color: #94a3b8; font-weight: 500; }
    .sub-score .label { font-size: 11px; color: #888; text-transform: uppercase; }
    .section { margin-bottom: 32px; }
    .section h2 { font-size: 20px; color: ${color}; margin-bottom: 16px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
    .finding { background: #fff; border-left: 4px solid #ef4444; padding: 12px 16px; margin-bottom: 8px; border-radius: 0 8px 8px 0; }
    .finding.high { border-color: #f97316; }
    .finding.medium { border-color: #eab308; }
    .finding h3 { font-size: 14px; font-weight: 600; }
    .finding p { font-size: 13px; color: #666; margin-top: 4px; }
    .coverage-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .coverage-item { padding: 8px 12px; border-radius: 6px; font-size: 13px; }
    .coverage-item.present { background: #dcfce7; color: #166534; }
    .coverage-item.missing { background: #fee2e2; color: #991b1b; }
    .roadmap-item { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
    .roadmap-week { background: ${color}; color: white; border-radius: 6px; padding: 4px 10px; font-size: 12px; font-weight: 600; white-space: nowrap; height: fit-content; }
    .roadmap-content h3 { font-size: 14px; font-weight: 600; }
    .roadmap-content p { font-size: 13px; color: #666; }
    .impact { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    .impact.critical { background: #fee2e2; color: #991b1b; }
    .impact.high { background: #ffedd5; color: #9a3412; }
    .impact.medium { background: #fef9c3; color: #854d0e; }
    .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 12px; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 16px 0; }
    .metric { text-align: center; }
    .metric .value { font-size: 28px; font-weight: 700; color: ${color}; }
    .metric .label { font-size: 12px; color: #888; }
    .tag { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.3px; vertical-align: middle; }
    .tag.live { background: #dcfce7; color: #166534; }
    .tag.partial { background: #fef9c3; color: #854d0e; }
    .tag.estimated { background: #e0e7ff; color: #3730a3; }
    .tag.unavailable { background: #f1f5f9; color: #64748b; }
    .win-row { background: #fff; border-left: 4px solid #f97316; padding: 10px 14px; margin-bottom: 8px; border-radius: 0 8px 8px 0; }
    .win-row h3 { font-size: 13px; font-weight: 600; }
    .win-row p { font-size: 12px; color: #666; margin-top: 3px; }
    .kw-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
    .kw-pos { background: ${color}; color: #fff; border-radius: 6px; padding: 2px 9px; font-weight: 700; font-size: 12px; }
    .legend { font-size: 11px; color: #94a3b8; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${brand}</h1>
      <p>OmniPresence Report — ${e(data.project.name)} (${e(data.project.domain)})</p>
      <p style="font-size: 12px;">Generated ${e(new Date(data.generatedAt).toLocaleDateString())}</p>
    </div>

    <div class="score-hero">
      <div class="score-number">${Math.round(data.score.omnipresence_score)}</div>
      <div class="score-label">OmniPresence Score — ${e(scoreLabel.label)}</div>
    </div>

    ${data.proofHtml || ""}

    <div class="sub-scores">
      ${subScoreHTML("AI Visibility", data.score.ai_visibility, subScoreAvailable["AI Visibility"])}
      ${subScoreHTML("Search", data.score.search_visibility, subScoreAvailable.Search)}
      ${subScoreHTML("Local", data.score.local_visibility, subScoreAvailable.Local)}
      ${subScoreHTML("Social", data.score.social_presence, subScoreAvailable.Social)}
      ${subScoreHTML("Directories", data.score.directory_coverage, subScoreAvailable.Directories)}
      ${subScoreHTML("Authority", data.score.authority_mentions, subScoreAvailable.Authority)}
      ${subScoreHTML("Technical", data.score.technical_readiness, subScoreAvailable.Technical)}
      ${subScoreHTML("Conversion", data.score.conversion_readiness, subScoreAvailable.Conversion)}
    </div>

    <div class="section">
      <h2>AI Visibility Metrics <span class="tag ${aiProvenance.toLowerCase()}">${e(aiProvenance)}</span></h2>
      <div class="metrics">
        <div class="metric"><div class="value">${Math.round(visibility.mentionRate * 100)}%</div><div class="label">Mention Rate</div></div>
        <div class="metric"><div class="value">${Math.round(visibility.citationRate * 100)}%</div><div class="label">Citation Rate</div></div>
        <div class="metric"><div class="value">${Math.round(visibility.winRate * 100)}%</div><div class="label">Win Rate</div></div>
      </div>
      <p class="legend">Recommendation strength: ${Math.round((visibility.prominence ?? 0) * 100)}%${visibility.avgPosition !== null ? ` · Avg. answer position: #${visibility.avgPosition}` : ""} — how strongly (not just whether) AI engines recommend you when you appear.</p>
      <p class="legend">Based on ${measuredPct}% measured AI probes${maxSamples > 1 ? `, each AI prompt sampled up to ${maxSamples}× and majority-voted to control for AI response volatility` : ""}. Rates are computed only over engines we could measure this run; unmeasured engines are excluded rather than counted as zero.</p>
      ${visibility.sampleSize > 0 ? `<p class="legend">Mention rate 95% confidence interval: <strong>${Math.round(visibility.mentionRateCI.low * 100)}%–${Math.round(visibility.mentionRateCI.high * 100)}%</strong> across ${visibility.sampleSize} measured probe${visibility.sampleSize === 1 ? "" : "s"} · overall read confidence <strong>${Math.round(visibility.confidence * 100)}%</strong>. A narrower band means a more certain measurement.</p>` : ""}
    </div>

    ${sov.sampleSize > 0 && sov.leaderboard.length > 0 ? `
    <div class="section">
      <h2>AI Share of Voice${sov.brandRank !== null ? ` <span class="tag ${sov.brandRank === 1 ? "live" : "estimated"}">Rank #${sov.brandRank} of ${sov.leaderboard.length}</span>` : ""}</h2>
      <p class="legend">Prominence-weighted across ${sov.sampleSize} measured AI answer${sov.sampleSize === 1 ? "" : "s"} — being named as the #1 pick counts more than a passing mention near the bottom, the way real buyers act on AI answers.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;">
        <thead><tr style="text-align:left;border-bottom:1px solid #e2e2e2;">
          <th style="padding:6px 4px;">Brand</th><th style="padding:6px 4px;">Share of Voice</th><th style="padding:6px 4px;">Answers</th><th style="padding:6px 4px;">Avg. position</th>
        </tr></thead>
        <tbody>
        ${sov.leaderboard.map((row) => `
          <tr style="border-bottom:1px solid #f1f1f1;${row.isBrand ? "font-weight:600;background:#f7faff;" : ""}">
            <td style="padding:6px 4px;">${e(row.name)}${row.isBrand ? " (you)" : ""}</td>
            <td style="padding:6px 4px;">${Math.round(row.shareOfVoice * 100)}%</td>
            <td style="padding:6px 4px;">${row.appearances}</td>
            <td style="padding:6px 4px;">${row.avgPosition !== null ? `#${row.avgPosition}` : "—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      ${sovByEngine.length > 1 ? `
      <h3 style="font-size:14px;margin:16px 0 6px;">Where you win and lose by engine</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="text-align:left;border-bottom:1px solid #e2e2e2;">
          <th style="padding:6px 4px;">Engine</th><th style="padding:6px 4px;">Your share</th><th style="padding:6px 4px;">Your rank</th><th style="padding:6px 4px;">Leader</th>
        </tr></thead>
        <tbody>
        ${sovByEngine.map((row) => {
          const leader = row.sov.leaderboard[0];
          return `<tr style="border-bottom:1px solid #f1f1f1;">
            <td style="padding:6px 4px;">${e(ENGINE_LABELS[row.engine] || row.engine)}</td>
            <td style="padding:6px 4px;">${Math.round((row.sov.brand?.shareOfVoice ?? 0) * 100)}%</td>
            <td style="padding:6px 4px;">${row.sov.brandRank ? `#${row.sov.brandRank} of ${row.sov.leaderboard.length}` : "absent"}</td>
            <td style="padding:6px 4px;">${leader ? `${e(leader.name)}${leader.isBrand ? " (you)" : ""} · ${Math.round(leader.shareOfVoice * 100)}%` : "—"}</td>
          </tr>`;
        }).join("")}
        </tbody>
      </table>` : ""}
    </div>` : ""}

    ${competitorWinPrompts.length > 0 ? `
    <div class="section">
      <h2>AI Prompts Where Competitors Win (${competitorWinPrompts.length})</h2>
      <p style="font-size:13px;color:#666;margin-bottom:12px;">Buyer-intent prompts where an AI engine recommended a competitor and did not mention you — your highest-priority AEO gaps.</p>
      ${competitorWinPrompts.map((w) => `
        <div class="win-row">
          <h3>${e(w.prompt)} <span class="tag estimated">${e(w.engine)}</span></h3>
          <p>Winning: ${e(w.winners.slice(0, 3).join(", "))}</p>
        </div>
      `).join("")}
    </div>
    ` : ""}

    ${data.strikingKeywords && data.strikingKeywords.length > 0 ? `
    <div class="section">
      <h2>Fastest-Upside Keywords <span class="tag live">Live rank</span></h2>
      <p style="font-size:13px;color:#666;margin-bottom:12px;">Already ranking positions 4-20 — small optimizations here usually deliver the fastest traffic gains.</p>
      ${data.strikingKeywords.map((k) => `
        <div class="kw-row">
          <span>${e(k.keyword)}${k.url ? ` <span style="color:#94a3b8;font-size:11px;">${e(k.url)}</span>` : ""}</span>
          <span class="kw-pos">#${e(k.position)}</span>
        </div>
      `).join("")}
    </div>
    ` : ""}

    <div class="section">
      <h2>Critical Issues (${criticalFindings.length})</h2>
      ${criticalFindings.slice(0, 8).map((f) => `
        <div class="finding ${e(f.severity)}">
          <h3>${e(f.title)}</h3>
          <p>${e(f.description)}</p>
          ${f.fix_recommendation ? `<p><strong>Fix:</strong> ${e(f.fix_recommendation)}</p>` : ""}
        </div>
      `).join("")}
    </div>

    <div class="section">
      <h2>Platform Coverage</h2>
      <div class="coverage-grid">
        ${data.coverageItems.map((c) => `
          <div class="coverage-item ${c.is_present ? "present" : "missing"}">
            ${c.is_present ? "✓" : "✗"} ${e(c.platform_name)}
          </div>
        `).join("")}
      </div>
      ${missingCoverage.length > 0 ? `<p style="margin-top: 12px; font-size: 13px; color: #666;">${missingCoverage.length} platforms missing. Competitors present on ${data.coverageItems.filter((c) => c.competitor_present && !c.is_present).length} of them.</p>` : ""}
      ${missingCoverage.length > 0 ? `<p class="legend">Gaps by surface — Social: ${socialGaps.length} · Directories: ${directoryGaps.length} · Local: ${localGaps.length} · Reviews: ${reviewGaps.length}</p>` : ""}
    </div>

    <div class="section">
      <h2>Top Authority Opportunities</h2>
      ${topOpportunities.map((o) => `
        <div class="roadmap-item">
          <div class="roadmap-content">
            <h3>${e(o.target_site)} <span class="impact ${o.estimated_impact && o.estimated_impact > 70 ? "high" : "medium"}">${e(o.type)}</span></h3>
            <p>${e(o.pitch_angle || "Opportunity identified")}</p>
          </div>
        </div>
      `).join("")}
    </div>

    <div class="section">
      <h2>90-Day Execution Roadmap</h2>
      ${data.roadmapItems.slice(0, 15).map((item) => `
        <div class="roadmap-item">
          <div class="roadmap-week">Week ${item.week}</div>
          <div class="roadmap-content">
            <h3>${e(item.title)} <span class="impact ${e(item.impact)}">${e(item.impact)}</span></h3>
            <p>${e(item.description)}</p>
          </div>
        </div>
      `).join("")}
    </div>

    ${data.adsEquivalent ? `
    <div class="section">
      <h2>Paid Ads Replacement <span class="tag ${data.adsEquivalent.cpcSource === "real" ? "live" : "estimated"}">${data.adsEquivalent.cpcSource === "real" ? "Live CPC" : "Estimated CPC"}</span></h2>
      <div class="metrics">
        <div class="metric"><div class="value">$${e(data.adsEquivalent.totalOrganicValue.toLocaleString())}</div><div class="label">Organic Value</div></div>
        <div class="metric"><div class="value">${Math.round(data.adsEquivalent.replacementRatio * 100)}%</div><div class="label">Replacement Ratio</div></div>
        <div class="metric"><div class="value">$${e(data.adsEquivalent.statedAdSpend.toLocaleString())}</div><div class="label">Stated Ad Spend</div></div>
      </div>
      <p class="legend">Organic value = measured GA4 organic + AI-referral sessions × ${data.adsEquivalent.cpcSource === "real" ? "your real keyword CPC (Google Ads Keyword Planner)" : "an industry-average CPC estimate (connect DataForSEO for your exact CPC)"}.</p>
    </div>
    ` : ""}

    ${receiptsSectionHTML(data)}

    ${methodologyAppendixHTML(data, { measuredPct, maxSamples, aiProvenance })}

    <div class="footer">
      <p>Report generated by ${brand} — The Organic Visibility Engine</p>
      <p>Built to reduce dependence on paid ads by creating compounding organic visibility.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Verifiable-receipts appendix: the client-facing proof that the AI numbers in
 * this report are real measurements, not screenshots or estimates. Each row
 * links to the public verification page where anyone can recompute the hash
 * chain independently. Rendered only when receipts exist — never a fake
 * "verified" stamp on a run that produced no evidence.
 */
function receiptsSectionHTML(data: ReportData): string {
  const receipts = data.receipts || [];
  if (receipts.length === 0) return "";
  const base = (data.verifyBaseUrl || "").replace(/\/$/, "");

  return `
    <div class="section">
      <h2>Verifiable Receipts</h2>
      <p class="legend">Every measured AI answer behind this report carries a tamper-evident receipt: prompt, exact surface, capture timestamp, response hash, and its position in a hash chain. Follow any link to verify independently — no login required.</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">
        <thead><tr style="text-align:left;border-bottom:1px solid #e2e2e2;">
          <th style="padding:6px 4px;">Prompt</th><th style="padding:6px 4px;">Surface</th><th style="padding:6px 4px;">Captured</th><th style="padding:6px 4px;">Receipt</th>
        </tr></thead>
        <tbody>
        ${receipts
          .map(
            (r) => `<tr style="border-bottom:1px solid #f1f1f1;vertical-align:top;">
            <td style="padding:6px 4px;">${e(r.prompt.slice(0, 90))}</td>
            <td style="padding:6px 4px;white-space:nowrap;">${e((r.surface || r.engine).replace(/_/g, " "))}</td>
            <td style="padding:6px 4px;white-space:nowrap;">${e(new Date(r.captured_at).toLocaleDateString())}</td>
            <td style="padding:6px 4px;white-space:nowrap;"><a href="${e(`${base}/verify/${r.id}`)}">${e(r.id.slice(0, 8))}…</a>${r.chained ? "" : ` <span style="color:#94a3b8;">(unchained)</span>`}</td>
          </tr>`
          )
          .join("")}
        </tbody>
      </table>
    </div>`;
}

/**
 * P3 fix ("methodology appendix"): the standard report presented scores,
 * rates, and dollar figures with no explanation of how any of them were
 * derived or which were measured vs. estimated — a hostile reader (or a
 * client's own analyst) had no way to audit the numbers without reading
 * source code. This mirrors the deep intelligence report's existing
 * "Methodology & Data Sources" section (intelligence-report-template.ts),
 * scoped to what a standard report actually computes.
 */
function methodologyAppendixHTML(
  data: ReportData,
  ctx: { measuredPct: number; maxSamples: number; aiProvenance: string }
): string {
  const rows = buildMethodologyRows(data, ctx);

  return `
    <div class="section">
      <h2>Methodology &amp; Data Sources</h2>
      <p class="legend">Every figure in this report is labeled by how it was derived. Full data-quality definitions: <a href="https://github.com/reda-baqechame/Omnipresence-engine/blob/main/docs/DATA_CONTRACT.md">Data Contract</a>.</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">
        <thead><tr style="text-align:left;border-bottom:1px solid #e2e2e2;">
          <th style="padding:6px 4px;">Metric</th><th style="padding:6px 4px;">How it's derived</th>
        </tr></thead>
        <tbody>
        ${rows
          .map(
            (r) => `<tr style="border-bottom:1px solid #f1f1f1;vertical-align:top;">
            <td style="padding:6px 4px;font-weight:600;white-space:nowrap;">${e(r.metric)}</td>
            <td style="padding:6px 4px;color:#555;">${e(r.method)}</td>
          </tr>`
          )
          .join("")}
        </tbody>
      </table>
      <p class="legend" style="margin-top:8px;">AI visibility read this run: <strong>${e(ctx.aiProvenance)}</strong>. Data sources: Supabase (project records) \u00b7 OmniPresence Engine (scoring &amp; measurement pipeline)${data.adsEquivalent?.cpcSource === "real" ? " \u00b7 Google Ads Keyword Planner (real CPC)" : ""}.</p>
    </div>`;
}

/**
 * P0 fix: see getSubScoreAvailability() in subscore-availability.ts — an
 * unmeasured dimension's raw value column is a real `0`, indistinguishable
 * from an actually-measured zero. `available` defaults to true so existing
 * callers that don't pass it keep the prior (measured) rendering.
 */
function subScoreHTML(label: string, value: number, available = true): string {
  if (!available) {
    return `<div class="sub-score"><div class="value value-nodata">—</div><div class="label">${e(label)}</div></div>`;
  }
  return `<div class="sub-score"><div class="value">${Math.round(value)}</div><div class="label">${e(label)}</div></div>`;
}
