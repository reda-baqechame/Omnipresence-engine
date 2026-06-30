import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AttributionPanel } from "@/components/attribution-panel";
import type { AttributionMetric } from "@/types/database";
import { getProject } from "@/lib/projects";
import {
  modelChannelAttribution,
  type AttributionModel,
} from "@/lib/engines/attribution";
import { getConnectorHealth } from "@/lib/engines/connector-health";

export default async function AttributionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();

  const [{ data: attribution }, { data: connections }] = await Promise.all([
    supabase
      .from("attribution_metrics")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(2),
    supabase.from("oauth_connections").select("provider, metadata").eq("project_id", id),
  ]);

  const ga4Conn = connections?.find((c) => c.provider === "google_analytics");
  const plausibleConn = connections?.find((c) => c.provider === "plausible");

  const connectorHealth = await getConnectorHealth(supabase, id);
  const healthBadge: Record<string, string> = {
    ok: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    expired: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    stale: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    disconnected: "bg-muted text-muted-foreground",
  };

  const latest = (attribution || [])[0] as AttributionMetric | undefined;
  const channelTotals = latest
    ? {
        ai_referrals: latest.ai_referral_traffic ?? 0,
        organic: latest.organic_traffic ?? 0,
        social: latest.social_clicks ?? 0,
        directories: latest.directory_referrals ?? 0,
        search: latest.search_clicks ?? 0,
      }
    : null;
  const hasChannelData =
    channelTotals && Object.values(channelTotals).some((v) => v > 0);
  const models = hasChannelData ? modelChannelAttribution(channelTotals) : null;
  const modelOrder: AttributionModel[] = [
    "first_touch",
    "last_touch",
    "linear",
    "position_based",
  ];
  const modelLabels: Record<AttributionModel, string> = {
    first_touch: "First touch",
    last_touch: "Last touch",
    linear: "Linear",
    position_based: "Position-based (40/20/40)",
  };

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold">Connector Health</h3>
            <p className="text-sm text-muted-foreground mt-1">
              First-party data feeding your outcome proof. {connectorHealth.reason}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
              connectorHealth.outcomeGuaranteeEligible
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            }`}
          >
            {connectorHealth.outcomeGuaranteeEligible
              ? "Outcome guarantee: active"
              : "Outcome guarantee: not yet eligible"}
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mt-4">
          {connectorHealth.connectors.map((c) => (
            <div
              key={c.provider}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
            >
              <span className="text-xs capitalize">
                {c.provider.replace(/_/g, " ")}
                {c.isOutcomeSource && (
                  <span className="ml-1 text-[10px] text-muted-foreground">(outcome)</span>
                )}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${healthBadge[c.health]}`}
              >
                {c.health}
              </span>
            </div>
          ))}
        </div>
      </div>

      <AttributionPanel
        projectId={id}
        domain={project.domain}
        industry={project.industry}
        monthlyAdSpend={project.monthly_ad_spend}
        metrics={(attribution || []) as AttributionMetric[]}
        hasGscConnection={connections?.some((c) => c.provider === "google_search_console") || false}
        hasBingConnection={connections?.some((c) => c.provider === "bing_webmaster") || false}
        hasGa4Connection={!!ga4Conn}
        hasPlausibleConnection={!!plausibleConn}
        ga4PropertyId={(ga4Conn?.metadata as { property_id?: string } | null)?.property_id}
        plausibleSiteId={(plausibleConn?.metadata as { site_id?: string } | null)?.site_id}
      />

      {models && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold">Multi-Touch Attribution</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Credit distribution across channels under four models, modeled from this
            period&apos;s channel volumes (discovery channels weighted toward first touch,
            intent channels toward last touch).
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {modelOrder.map((m) => (
              <div key={m} className="rounded-lg border border-border p-4">
                <p className="text-sm font-medium mb-3">{modelLabels[m]}</p>
                <ul className="space-y-2">
                  {models[m].map((c) => (
                    <li key={c.channel} className="text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="capitalize">{c.channel.replace(/_/g, " ")}</span>
                        <span className="text-muted-foreground">
                          {c.percent}% · {c.credit.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted">
                        <div
                          className="h-1.5 rounded-full bg-primary"
                          style={{ width: `${Math.min(c.percent, 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
