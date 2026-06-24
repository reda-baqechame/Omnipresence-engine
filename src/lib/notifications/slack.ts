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

export function buildWeeklyReportSlackMessage(
  projectName: string,
  domain: string,
  score: number,
  previousScore: number | undefined,
  dashboardUrl: string,
  brandName?: string
): SlackMessage {
  const delta =
    previousScore !== undefined ? score - previousScore : null;
  const deltaText =
    delta !== null
      ? ` (${delta >= 0 ? "+" : ""}${Math.round(delta)} MoM)`
      : "";

  return {
    text: `${brandName || "PresenceOS"} weekly report: ${projectName} scored ${Math.round(score)}/100${deltaText}`,
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
