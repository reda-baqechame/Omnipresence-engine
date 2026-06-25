import { Resend } from "resend";
import { generateReportHTML, type ReportData } from "@/lib/engines/report-generator";

let resendClient: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

export async function sendWeeklyReport(
  toEmail: string,
  reportData: ReportData,
  whiteLabel?: { name: string; color: string }
): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;

  const html = generateReportHTML(reportData, whiteLabel);

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "reports@presenceos.app",
      to: toEmail,
      subject: `Weekly OmniPresence Report — ${reportData.project.name} (Score: ${Math.round(reportData.score.omnipresence_score)}/100)`,
      html,
    });
    return true;
  } catch {
    return false;
  }
}

export async function sendAuditLeadEmail(
  toEmail: string,
  domain: string,
  score: number
): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "reports@presenceos.app",
      to: toEmail,
      subject: `Your OmniPresence preview — ${domain} scored ${Math.round(score)}/100`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #6366f1;">Your Free Visibility Preview</h1>
          <p>We analyzed <strong>${domain}</strong> across technical readiness and AI visibility signals.</p>
          <p style="font-size: 48px; font-weight: bold; color: #6366f1;">${Math.round(score)}/100</p>
          <p>Sign up for the full audit with competitor analysis, 90-day roadmap, and white-label PDF report.</p>
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/signup" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Get Full Audit</a>
        </div>
      `,
    });
    return true;
  } catch {
    return false;
  }
}

export async function sendScoreDropAlert(
  toEmail: string,
  projectName: string,
  previousScore: number,
  newScore: number,
  projectId: string
): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;

  const drop = previousScore - newScore;
  if (drop < 5) return false;

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "reports@presenceos.app",
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
    return true;
  } catch {
    return false;
  }
}

export async function sendScanCompleteEmail(
  toEmail: string,
  projectName: string,
  score: number,
  projectId: string
): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "reports@presenceos.app",
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
    return true;
  } catch {
    return false;
  }
}
