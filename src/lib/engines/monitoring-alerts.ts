import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMonitoringAlert, type MonitoringAlertItem } from "@/lib/email/reports";
import { sendSlackWebhook, buildMonitoringSlackMessage } from "@/lib/notifications/slack";

/**
 * Consolidated monitoring alerts (Phase 11).
 *
 * Aggregates the day's measured changes for a project - rank drops (Phase 8
 * rank_alerts), technical finding regressions (Phase 9 finding_snapshots), and
 * SERP-feature losses - and dispatches them via email (org owner) and Slack
 * (if a webhook is configured). Only real, measured changes are sent.
 */

export async function collectProjectAlertItems(
  supabase: SupabaseClient,
  projectId: string
): Promise<MonitoringAlertItem[]> {
  const items: MonitoringAlertItem[] = [];

  // Rank drops captured during rank checks (unacknowledged only).
  const { data: rankAlerts } = await supabase
    .from("rank_alerts")
    .select("keyword, previous_position, current_position, delta, alert_type")
    .eq("project_id", projectId)
    .eq("acknowledged", false)
    .order("created_at", { ascending: false })
    .limit(20);

  for (const a of rankAlerts || []) {
    if (a.alert_type === "lost_ranking") {
      items.push({ type: "rank_drop", message: `"${a.keyword}" fell out of the tracked results.` });
    } else {
      items.push({
        type: "rank_drop",
        message: `"${a.keyword}" dropped ${Math.abs(a.delta ?? 0)} positions (${a.previous_position ?? "?"} → ${a.current_position ?? "?"}).`,
      });
    }
  }

  // Latest crawl diff: regressions are the highest-signal technical change.
  const { data: snap } = await supabase
    .from("finding_snapshots")
    .select("regressed_count, regressed_titles, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snap && snap.regressed_count > 0) {
    const titles = (snap.regressed_titles || []) as string[];
    items.push({
      type: "finding_regression",
      message: `${snap.regressed_count} previously-fixed issue(s) returned${titles.length ? `: ${titles.slice(0, 3).join("; ")}` : ""}.`,
    });
  }

  return items;
}

export async function dispatchProjectAlerts(
  supabase: SupabaseClient,
  project: { id: string; name: string; organization_id: string },
  options?: { ownerEmail?: string | null }
): Promise<{ sent: boolean; itemCount: number }> {
  const items = await collectProjectAlertItems(supabase, project.id);
  if (items.length === 0) return { sent: false, itemCount: 0 };

  let sent = false;

  // Org notification settings (Slack + enable flag).
  const { data: org } = await supabase
    .from("organizations")
    .select("white_label_name, slack_webhook_url, notifications_enabled")
    .eq("id", project.organization_id)
    .single();

  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/app/projects/${project.id}/ranks`;

  if (org?.notifications_enabled !== false && org?.slack_webhook_url) {
    const ok = await sendSlackWebhook(
      org.slack_webhook_url,
      buildMonitoringSlackMessage(project.name, items, dashboardUrl, org.white_label_name || undefined)
    );
    sent = sent || ok;
  }

  if (options?.ownerEmail) {
    const ok = await sendMonitoringAlert(options.ownerEmail, project.name, project.id, items);
    sent = sent || ok;
  }

  return { sent, itemCount: items.length };
}
