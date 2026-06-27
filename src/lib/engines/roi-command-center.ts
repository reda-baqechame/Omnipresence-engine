import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttributionMetric } from "@/types/database";
import { calculateMoMDelta } from "@/lib/engines/attribution";

/**
 * Phase 21: Attribution & ROI command center.
 *
 * One dashboard that proves money: unifies organic / AI / social / directory
 * clicks, leads, revenue and paid-ad-equivalent value with month-over-month
 * deltas and honest provenance, plus revenue-by-landing-page and an optional
 * read-only UX layer (Microsoft Clarity / Hotjar).
 */

export interface CommandCenterSummary {
  available: boolean;
  reason?: string;
  period?: { start: string; end: string };
  totals?: {
    organicTraffic: number;
    aiReferralTraffic: number;
    socialClicks: number;
    directoryReferrals: number;
    searchClicks: number;
    leads: number;
    revenue: number;
    paidAdsEquivalent: number;
  };
  deltas?: Record<string, { value: number; change: number; changePercent: number }>;
  channelMix?: Array<{ channel: string; value: number; percent: number }>;
  dataSource?: string;
  isEstimated?: boolean;
  /** Revenue is only real when GA4 (the revenue source) actually returned data. */
  revenueAvailable?: boolean;
  /** Paid-ad equivalent is always a modeled CPC estimate, never measured spend. */
  paidAdsEquivalentEstimated?: boolean;
  confidence?: number;
}

export async function buildCommandCenter(
  supabase: SupabaseClient,
  projectId: string
): Promise<CommandCenterSummary> {
  const { data: rows } = await supabase
    .from("attribution_metrics")
    .select("*")
    .eq("project_id", projectId)
    .order("period_end", { ascending: false })
    .limit(2);

  if (!rows || rows.length === 0) {
    return {
      available: false,
      reason: "No attribution data yet. Connect GA4 / Plausible and run a sync in the Attribution tab.",
    };
  }

  const current = rows[0] as AttributionMetric;
  const previous = (rows[1] as AttributionMetric) || current;

  const totals = {
    organicTraffic: current.organic_traffic || 0,
    aiReferralTraffic: current.ai_referral_traffic || 0,
    socialClicks: current.social_clicks || 0,
    directoryReferrals: current.directory_referrals || 0,
    searchClicks: current.search_clicks || 0,
    leads: current.leads || 0,
    revenue: current.revenue || 0,
    paidAdsEquivalent: current.paid_ads_equivalent || 0,
  };

  const deltas = rows.length > 1 ? calculateMoMDelta(current, previous) : undefined;

  const mix = [
    { channel: "Organic", value: totals.organicTraffic },
    { channel: "AI referrals", value: totals.aiReferralTraffic },
    { channel: "Social", value: totals.socialClicks },
    { channel: "Directories", value: totals.directoryReferrals },
    { channel: "Search", value: totals.searchClicks },
  ];
  const grand = mix.reduce((s, m) => s + m.value, 0) || 1;
  const channelMix = mix
    .filter((m) => m.value > 0)
    .map((m) => ({ channel: m.channel, value: m.value, percent: Math.round((m.value / grand) * 1000) / 10 }))
    .sort((a, b) => b.value - a.value);

  const sourceAvailability = (current.source_availability as Record<string, boolean> | null) || null;
  // Revenue is trustworthy only when GA4 reported it this period. If GA4 wasn't a
  // working source, revenue is unavailable (shown as "—"), never a confident $0.
  const revenueAvailable = sourceAvailability
    ? sourceAvailability.revenue === true
    : (current.data_source as string) === "measured" && (current.revenue || 0) > 0;

  return {
    available: true,
    period: { start: current.period_start, end: current.period_end },
    totals,
    deltas,
    channelMix,
    dataSource: (current.data_source as string) || "mixed",
    isEstimated: Boolean(current.is_estimated),
    revenueAvailable,
    paidAdsEquivalentEstimated: true,
    confidence: typeof current.confidence === "number" ? current.confidence : undefined,
  };
}

/** Optional read-only UX layer embed config (Clarity / Hotjar). */
export interface UxLayerConfig {
  clarityProjectId?: string;
  hotjarSiteId?: string;
}

export function buildUxEmbeds(config: UxLayerConfig): Array<{ tool: string; embedUrl?: string; note: string }> {
  const out: Array<{ tool: string; embedUrl?: string; note: string }> = [];
  if (config.clarityProjectId) {
    out.push({
      tool: "Microsoft Clarity",
      embedUrl: `https://clarity.microsoft.com/projects/view/${config.clarityProjectId}/dashboard`,
      note: "Open Clarity heatmaps & session recordings (read-only link).",
    });
  }
  if (config.hotjarSiteId) {
    out.push({
      tool: "Hotjar",
      embedUrl: `https://insights.hotjar.com/sites/${config.hotjarSiteId}/dashboard`,
      note: "Open Hotjar dashboard (read-only link).",
    });
  }
  return out;
}
