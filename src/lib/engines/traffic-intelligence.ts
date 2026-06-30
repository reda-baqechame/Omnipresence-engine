/**
 * Honest 3-layer Traffic Intelligence.
 *
 * Incumbents (Similarweb/Ahrefs) sell absolute "visits" numbers backed by a
 * years-deep clickstream panel + crawl flywheel we do not have. Rather than
 * fabricate precision, we deliver three clearly-labeled layers, and EVERY number
 * carries an explicit provenance tag so the UI can never imply more certainty
 * than we actually have:
 *
 *   1. first_party_measured — the brand's REAL traffic from connected GA4 / GSC /
 *      Plausible / PostHog (via attribution_metrics). The only absolute counts we
 *      ever show. Gated on connector health (no healthy source → unavailable).
 *   2. panel_observed — opt-in clickstream panel. We operate no panel network, so
 *      this layer is honestly `unavailable` unless an operator configures one.
 *   3. model_estimated — competitor view. A RELATIVE traffic index (0-100), not a
 *      visit count, modeled from public popularity signals (rank.to + Tranco +
 *      Common Crawl + Wikipedia + age). Always labeled estimated + relative.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttributionMetric } from "@/types/database";
import { getConnectorHealth } from "@/lib/engines/connector-health";
import { getCompetitiveSnapshot } from "@/lib/engines/competitive-snapshot";

export type TrafficProvenance = "first_party_measured" | "panel_observed" | "model_estimated" | "unavailable";

export interface FirstPartyTraffic {
  provenance: TrafficProvenance;
  available: boolean;
  reason?: string;
  period?: { start: string; end: string };
  /** Channels whose source was healthy this period are shown; others omitted. */
  channels: Array<{ channel: string; value: number; available: boolean }>;
  totalMeasured: number;
  confidence?: number;
}

export interface PanelTraffic {
  provenance: TrafficProvenance;
  available: boolean;
  reason: string;
}

export interface CompetitorTrafficEstimate {
  domain: string;
  /** RELATIVE traffic index 0-100 (NOT visits). */
  trafficIndex: number;
  globalRank?: number;
  signals: string[];
  provenance: TrafficProvenance;
  available: boolean;
}

export interface TrafficIntelligence {
  firstParty: FirstPartyTraffic;
  panel: PanelTraffic;
  competitors: CompetitorTrafficEstimate[];
  /** Honest summary note rendered under the page header. */
  note: string;
}

const CHANNEL_LABELS: Record<string, string> = {
  organicTraffic: "Organic",
  aiReferralTraffic: "AI referrals",
  socialClicks: "Social",
  directoryReferrals: "Directories",
  searchClicks: "Search",
};

async function buildFirstParty(supabase: SupabaseClient, projectId: string): Promise<FirstPartyTraffic> {
  const health = await getConnectorHealth(supabase, projectId);
  const { data: rows } = await supabase
    .from("attribution_metrics")
    .select("*")
    .eq("project_id", projectId)
    .order("period_end", { ascending: false })
    .limit(1);

  const current = (rows?.[0] as AttributionMetric | undefined) || undefined;
  if (!current) {
    return {
      provenance: "unavailable",
      available: false,
      reason: health.hasAnyConnection
        ? "First-party sources connected but no traffic synced yet — run an Attribution sync."
        : "No first-party analytics connected. Connect GA4 / GSC / Plausible to measure real traffic.",
      channels: [],
      totalMeasured: 0,
    };
  }

  const sourceAvailability = (current.source_availability as Record<string, boolean> | null) || null;
  const raw: Record<string, number> = {
    organicTraffic: current.organic_traffic || 0,
    aiReferralTraffic: current.ai_referral_traffic || 0,
    socialClicks: current.social_clicks || 0,
    directoryReferrals: current.directory_referrals || 0,
    searchClicks: current.search_clicks || 0,
  };

  const channels = Object.entries(raw).map(([key, value]) => {
    const available = sourceAvailability ? sourceAvailability[key] === true : value > 0;
    return { channel: CHANNEL_LABELS[key] || key, value, available };
  });

  const totalMeasured = channels.filter((c) => c.available).reduce((s, c) => s + c.value, 0);

  return {
    provenance: "first_party_measured",
    available: channels.some((c) => c.available),
    reason: channels.some((c) => c.available)
      ? undefined
      : "Connected, but no channel reported healthy data for the latest period.",
    period: { start: current.period_start, end: current.period_end },
    channels,
    totalMeasured,
    confidence: typeof current.confidence === "number" ? current.confidence : undefined,
  };
}

function buildPanel(): PanelTraffic {
  // We run no clickstream panel. Honest by default — never fabricate panel data.
  const configured = process.env.TRAFFIC_PANEL_PROVIDER && process.env.TRAFFIC_PANEL_PROVIDER.length > 0;
  return {
    provenance: configured ? "panel_observed" : "unavailable",
    available: false,
    reason: configured
      ? "Panel provider configured but no panel observations ingested for this domain yet."
      : "Opt-in clickstream panel not configured. Panel-observed traffic is unavailable (we never estimate it as measured).",
  };
}

async function estimateCompetitor(domain: string): Promise<CompetitorTrafficEstimate> {
  try {
    const snap = await getCompetitiveSnapshot(domain, {});
    return {
      domain: snap.domain,
      trafficIndex: snap.popularity.score,
      globalRank: snap.popularity.globalRank,
      signals: snap.popularity.signals,
      provenance: "model_estimated",
      available: snap.popularity.available,
    };
  } catch {
    return { domain, trafficIndex: 0, signals: [], provenance: "unavailable", available: false };
  }
}

export async function buildTrafficIntelligence(
  supabase: SupabaseClient,
  projectId: string,
  brandDomain: string,
  competitors: string[]
): Promise<TrafficIntelligence> {
  const [firstParty, competitorEstimates] = await Promise.all([
    buildFirstParty(supabase, projectId),
    Promise.all([brandDomain, ...competitors.slice(0, 5)].filter(Boolean).map(estimateCompetitor)),
  ]);

  return {
    firstParty,
    panel: buildPanel(),
    competitors: competitorEstimates,
    note: "First-party numbers are your REAL measured traffic. The competitor view is a RELATIVE popularity index (0-100) modeled from public signals — not visit counts. We never fabricate absolute competitor traffic.",
  };
}
