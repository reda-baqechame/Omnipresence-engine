import { generateReportHTML, type ReportData } from "@/lib/engines/report-generator";
import { sendEmail, type EmailSendResult } from "@/lib/email/transport";

export interface AuditLeadEmailScores {
  aiVisibility?: number;
  searchVisibility?: number;
  technicalReadiness?: number;
  criticalIssues?: number;
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://omnipresence-engine.vercel.app").replace(/\/$/, "");
}

function signupCtaUrl(domain: string): string {
  const base = appBaseUrl();
  const params = new URLSearchParams({
    utm_source: "audit_email",
    utm_medium: "email",
    utm_campaign: "preview",
    domain,
  });
  return `${base}/signup?${params.toString()}`;
}

export async function sendWeeklyReport(
  toEmail: string,
  reportData: ReportData,
  whiteLabel?: { name: string; color: string }
): Promise<boolean> {
  const html = generateReportHTML(reportData, whiteLabel);
  const res = await sendEmail({
    to: toEmail,
    subject: `Weekly OmniPresence Report — ${reportData.project.name} (Score: ${Math.round(reportData.score.omnipresence_score)}/100)`,
    html,
  });
  return res.sent;
}

export async function sendAuditLeadEmail(
  toEmail: string,
  domain: string,
  score: number,
  subScores?: AuditLeadEmailScores
): Promise<EmailSendResult> {
  const scoreRows = [
    subScores?.aiVisibility != null
      ? `<tr><td style="padding:8px 0;color:#64748b;">AI visibility</td><td style="padding:8px 0;font-weight:600;text-align:right;">${Math.round(subScores.aiVisibility)}/100</td></tr>`
      : "",
    subScores?.searchVisibility != null
      ? `<tr><td style="padding:8px 0;color:#64748b;">Search visibility</td><td style="padding:8px 0;font-weight:600;text-align:right;">${Math.round(subScores.searchVisibility)}/100</td></tr>`
      : "",
    subScores?.technicalReadiness != null
      ? `<tr><td style="padding:8px 0;color:#64748b;">Technical readiness</td><td style="padding:8px 0;font-weight:600;text-align:right;">${Math.round(subScores.technicalReadiness)}/100</td></tr>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const criticalLine =
    subScores?.criticalIssues != null && subScores.criticalIssues > 0
      ? `<p style="color:#ef4444;margin:16px 0 0;"><strong>${subScores.criticalIssues}</strong> critical/high issue${subScores.criticalIssues === 1 ? "" : "s"} detected — fix these first for fastest gains.</p>`
      : "";

  const signupUrl = signupCtaUrl(domain);

  return sendEmail({
    to: toEmail,
    subject: `Your OmniPresence preview — ${domain} scored ${Math.round(score)}/100`,
    html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #6366f1;">Your Free Visibility Preview</h1>
          <p>We analyzed <strong>${domain}</strong> across technical readiness, search, and AI visibility signals.</p>
          <p style="font-size: 48px; font-weight: bold; color: #6366f1; margin-bottom: 8px;">${Math.round(score)}/100</p>
          ${scoreRows ? `<table style="width:100%;border-collapse:collapse;margin:0 0 16px;">${scoreRows}</table>` : ""}
          ${criticalLine}
          <p style="margin-top:20px;">Sign up for the full audit with competitor analysis, 90-day roadmap, and white-label PDF report.</p>
          <a href="${signupUrl}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 8px;">Get Full Audit</a>
          <p style="font-size:12px;color:#94a3b8;margin-top:24px;">OmniPresence Engine · ${appBaseUrl()}</p>
        </div>
      `,
  });
}

export async function sendScoreDropAlert(
  toEmail: string,
  projectName: string,
  previousScore: number,
  newScore: number,
  projectId: string
): Promise<boolean> {
  const drop = previousScore - newScore;
  if (drop < 5) return false;

  const res = await sendEmail({
    to: toEmail,
    subject: `Score alert — ${projectName} dropped ${Math.round(drop)} points`,
    html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #ef4444;">OmniPresence Score Alert</h1>
          <p>Your score for <strong>${projectName}</strong> decreased after the latest scan.</p>
          <p style="font-size: 32px; font-weight: bold;">
            <span style="color: #888;">${Math.round(previousScore)}</span>
            →
            <span style="color: #ef4444;">${Math.round(newScore)}</span>
          </p>
          <p>Review technical issues, competitor movement, and your roadmap for recovery actions.</p>
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/app/projects/${projectId}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">View Dashboard</a>
        </div>
      `,
  });
  return res.sent;
}

export async function sendCitationDropAlert(
  toEmail: string,
  projectName: string,
  previousCitations: number,
  newCitations: number,
  projectId: string
): Promise<boolean> {
  const drop = previousCitations - newCitations;
  if (drop <= 0) return false;

  const res = await sendEmail({
    to: toEmail,
    subject: `AI citation alert — ${projectName} lost ${drop} AI citation${drop === 1 ? "" : "s"}`,
    html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #ef4444;">AI Citation Drop</h1>
          <p>The number of AI answers citing <strong>${projectName}</strong> decreased since the previous run.</p>
          <p style="font-size: 32px; font-weight: bold;">
            <span style="color: #888;">${previousCitations}</span>
            →
            <span style="color: #ef4444;">${newCitations}</span>
          </p>
          <p>Check which prompts stopped citing you and review citation gaps for recovery.</p>
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/app/projects/${projectId}/visibility" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">View Visibility</a>
        </div>
      `,
  });
  return res.sent;
}

export interface MonitoringAlertItem {
  type:
    | "rank_drop"
    | "finding_regression"
    | "serp_feature"
    | "sov_delta"
    | "coverage_gap"
    | "competitor_win";
  message: string;
}

export async function sendMonitoringAlert(
  toEmail: string,
  projectName: string,
  projectId: string,
  items: MonitoringAlertItem[]
): Promise<boolean> {
  if (items.length === 0) return false;

  const rows = items
    .map(
      (i) =>
        `<li style="margin-bottom:6px;"><strong style="text-transform:capitalize;">${i.type.replace(/_/g, " ")}:</strong> ${i.message}</li>`
    )
    .join("");

  const res = await sendEmail({
    to: toEmail,
    subject: `Monitoring alert — ${projectName} (${items.length} change${items.length === 1 ? "" : "s"})`,
    html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #f59e0b;">OmniPresence Monitoring Alert</h1>
          <p>We detected ${items.length} change${items.length === 1 ? "" : "s"} for <strong>${projectName}</strong>:</p>
          <ul style="padding-left:18px;">${rows}</ul>
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/app/projects/${projectId}/ranks" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Review Changes</a>
        </div>
      `,
  });
  return res.sent;
}

export async function sendScanCompleteEmail(
  toEmail: string,
  projectName: string,
  score: number,
  projectId: string
): Promise<boolean> {
  const res = await sendEmail({
    to: toEmail,
    subject: `Scan complete — ${projectName} scored ${Math.round(score)}/100`,
    html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #6366f1;">OmniPresence Scan Complete</h1>
          <p>Your audit for <strong>${projectName}</strong> is ready.</p>
          <p style="font-size: 48px; font-weight: bold; color: #6366f1;">${Math.round(score)}/100</p>
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/app/projects/${projectId}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">View Full Report</a>
        </div>
      `,
  });
  return res.sent;
}
