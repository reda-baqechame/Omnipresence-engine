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
import { escapeHtml, sanitizeHexColor } from "@/lib/security/escape-html";

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
  generatedAt: string;
  /** Pre-rendered Before/After proof section (from proof-report.renderProofHTML). */
  proofHtml?: string;
  adsEquivalent?: {
    totalOrganicValue: number;
    replacementRatio: number;
    statedAdSpend: number;
  };
}

export function generateReportHTML(data: ReportData, whiteLabel?: { name: string; color: string }): string {
  const brand = e(whiteLabel?.name || "PresenceOS");
  const color = sanitizeHexColor(whiteLabel?.color);
  const scoreLabel = getScoreLabel(data.score.omnipresence_score);
  const visibility = calculateVisibilityMetrics(data.visibilityResults);
  const criticalFindings = data.technicalFindings.filter((f) => f.severity === "critical" || f.severity === "high");
  const missingCoverage = data.coverageItems.filter((c) => !c.is_present);
  const topOpportunities = data.authorityOpportunities.slice(0, 10);

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
      ${subScoreHTML("AI Visibility", data.score.ai_visibility)}
      ${subScoreHTML("Search", data.score.search_visibility)}
      ${subScoreHTML("Local", data.score.local_visibility)}
      ${subScoreHTML("Social", data.score.social_presence)}
      ${subScoreHTML("Directories", data.score.directory_coverage)}
      ${subScoreHTML("Authority", data.score.authority_mentions)}
      ${subScoreHTML("Technical", data.score.technical_readiness)}
      ${subScoreHTML("Conversion", data.score.conversion_readiness)}
    </div>

    <div class="section">
      <h2>AI Visibility Metrics</h2>
      <div class="metrics">
        <div class="metric"><div class="value">${Math.round(visibility.mentionRate * 100)}%</div><div class="label">Mention Rate</div></div>
        <div class="metric"><div class="value">${Math.round(visibility.citationRate * 100)}%</div><div class="label">Citation Rate</div></div>
        <div class="metric"><div class="value">${Math.round(visibility.winRate * 100)}%</div><div class="label">Win Rate</div></div>
      </div>
    </div>

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
      <h2>Paid Ads Replacement</h2>
      <div class="metrics">
        <div class="metric"><div class="value">$${e(data.adsEquivalent.totalOrganicValue.toLocaleString())}</div><div class="label">Organic Value</div></div>
        <div class="metric"><div class="value">${Math.round(data.adsEquivalent.replacementRatio * 100)}%</div><div class="label">Replacement Ratio</div></div>
        <div class="metric"><div class="value">$${e(data.adsEquivalent.statedAdSpend.toLocaleString())}</div><div class="label">Stated Ad Spend</div></div>
      </div>
    </div>
    ` : ""}

    <div class="footer">
      <p>Report generated by ${brand} — The Organic Visibility Engine</p>
      <p>Built to reduce dependence on paid ads by creating compounding organic visibility.</p>
    </div>
  </div>
</body>
</html>`;
}

function subScoreHTML(label: string, value: number): string {
  return `<div class="sub-score"><div class="value">${Math.round(value)}</div><div class="label">${e(label)}</div></div>`;
}
