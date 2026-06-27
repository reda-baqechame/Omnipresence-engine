export interface SlackMessage {
  text: string;
  blocks?: Array<Record<string, unknown>>;
}

export async function sendSlackWebhook(
  webhookUrl: string,
  message: SlackMessage
): Promise<boolean> {
  if (!webhookUrl) return false;

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function buildMonitoringSlackMessage(
  projectName: string,
  items: { type: string; message: string }[],
  dashboardUrl: string,
  brandName?: string
): SlackMessage {
  return {
    text: `${brandName || "PresenceOS"} alert: ${projectName} has ${items.length} change(s) to review.`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `⚠️ ${projectName} — ${items.length} change(s)` },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: items
            .slice(0, 10)
            .map((i) => `• *${i.type.replace(/_/g, " ")}:* ${i.message}`)
            .join("\n"),
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Review" },
            url: dashboardUrl,
          },
        ],
      },
    ],
  };
}

export function buildWeeklyReportSlackMessage(
  projectName: string,
  domain: string,
  score: number,
  previousScore: number | undefined,
  dashboardUrl: string,
  brandName?: string,
  adsEquivalent?: { totalOrganicValue: number; replacementRatio: number }
): SlackMessage {
  const delta =
    previousScore !== undefined ? score - previousScore : null;
  const deltaText =
    delta !== null
      ? ` (${delta >= 0 ? "+" : ""}${Math.round(delta)} MoM)`
      : "";
  const adsText = adsEquivalent
    ? ` Organic value: $${adsEquivalent.totalOrganicValue.toLocaleString()} (${Math.round(adsEquivalent.replacementRatio * 100)}% of ad spend).`
    : "";

  return {
    text: `${brandName || "PresenceOS"} weekly report: ${projectName} scored ${Math.round(score)}/100${deltaText}.${adsText}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `📊 Weekly OmniPresence Report` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Project:*\n${projectName}` },
          { type: "mrkdwn", text: `*Domain:*\n${domain}` },
          { type: "mrkdwn", text: `*Score:*\n${Math.round(score)}/100${deltaText}` },
          { type: "mrkdwn", text: `*Brand:*\n${brandName || "PresenceOS"}` },
        ],
      },
      ...(adsEquivalent
        ? [{
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Paid ads equivalent:* $${adsEquivalent.totalOrganicValue.toLocaleString()} (${Math.round(adsEquivalent.replacementRatio * 100)}% replacement)`,
            },
          }]
        : []),
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View Dashboard" },
            url: dashboardUrl,
          },
        ],
      },
    ],
  };
}
