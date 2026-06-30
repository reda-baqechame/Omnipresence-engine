import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Connector health + the hard outcome-guarantee gate (Wave S3).
 *
 * The platform only stands behind an OUTCOME guarantee (revenue/lead/traffic
 * lift) when it can actually measure those outcomes from connected first-party
 * data. "No connected data = no outcome guarantee" — this module is the single
 * source of truth for that rule, used by the connector-health dashboard and the
 * guarantee baseline lock.
 */

/** First-party providers whose presence backs the OUTCOME guarantee. */
export const FIRST_PARTY_PROVIDERS = [
  "google_search_console",
  "google_analytics",
  "bing_webmaster",
  "google_business_profile",
  "plausible",
  "posthog",
  "stripe",
  "shopify",
  "hubspot",
  "calendly",
  "google_ads",
  "meta_ads",
  "linkedin_ads",
] as const;

export type FirstPartyProvider = (typeof FIRST_PARTY_PROVIDERS)[number];

/** Providers that carry real money/lead outcomes (vs. traffic-only signals). */
const OUTCOME_PROVIDERS = new Set<string>([
  "google_analytics",
  "stripe",
  "shopify",
  "hubspot",
  "calendly",
]);

export interface ConnectorStatus {
  provider: string;
  connected: boolean;
  /** "ok" | "expired" | "stale" | "disconnected" */
  health: "ok" | "expired" | "stale" | "disconnected";
  expiresAt: string | null;
  lastSyncedAt: string | null;
  isOutcomeSource: boolean;
}

export interface ConnectorHealthReport {
  projectId: string;
  connectors: ConnectorStatus[];
  connectedCount: number;
  healthyCount: number;
  /** True when ≥1 healthy revenue/lead/traffic outcome source is connected. */
  outcomeGuaranteeEligible: boolean;
  /** All connected first-party sources, healthy or not. */
  hasAnyConnection: boolean;
  reason: string;
}

const STALE_MS = 14 * 24 * 60 * 60 * 1000;

function healthOf(
  connected: boolean,
  expiresAt: string | null,
  lastSyncedAt: string | null
): ConnectorStatus["health"] {
  if (!connected) return "disconnected";
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) return "expired";
  if (lastSyncedAt && Date.now() - new Date(lastSyncedAt).getTime() > STALE_MS) return "stale";
  return "ok";
}

export interface ConnectionRow {
  provider: string;
  access_token: string | null;
  expires_at: string | null;
  updated_at: string | null;
}

/**
 * Pure connector-health derivation from raw connection rows + the latest
 * attribution run's per-source availability. Kept dependency-free so it is
 * directly unit-testable (the outcome-guarantee gate is refund-critical).
 */
export function deriveConnectorReport(
  projectId: string,
  connections: ConnectionRow[],
  availability: Record<string, boolean> = {},
  lastChecked: string | null = null
): ConnectorHealthReport {
  const byProvider = new Map<string, ConnectionRow>();
  for (const c of connections || []) byProvider.set(c.provider, c);

  const connectors: ConnectorStatus[] = FIRST_PARTY_PROVIDERS.map((provider) => {
    const conn = byProvider.get(provider);
    const connected = Boolean(conn?.access_token);
    // A connection that failed its last sync is unhealthy even if the token exists.
    let health = healthOf(connected, conn?.expires_at ?? null, conn?.updated_at ?? lastChecked);
    if (connected && availability[provider] === false) health = "stale";
    return {
      provider,
      connected,
      health,
      expiresAt: conn?.expires_at ?? null,
      lastSyncedAt: conn?.updated_at ?? null,
      isOutcomeSource: OUTCOME_PROVIDERS.has(provider),
    };
  });

  const connected = connectors.filter((c) => c.connected);
  const healthy = connectors.filter((c) => c.health === "ok");
  const healthyOutcome = healthy.filter((c) => c.isOutcomeSource);
  const outcomeGuaranteeEligible = healthyOutcome.length > 0;

  return {
    projectId,
    connectors,
    connectedCount: connected.length,
    healthyCount: healthy.length,
    outcomeGuaranteeEligible,
    hasAnyConnection: connected.length > 0,
    reason: outcomeGuaranteeEligible
      ? `Outcome guarantee active — ${healthyOutcome.length} healthy outcome source(s): ${healthyOutcome
          .map((c) => c.provider)
          .join(", ")}.`
      : connected.length > 0
        ? "No HEALTHY revenue/lead/traffic source connected — only deterministic (work-we-control) guarantee applies until a money/analytics source is connected and syncing."
        : "No first-party data connected — outcome guarantee unavailable. Connect GA4, Stripe, Shopify, HubSpot, or Calendly to enable it.",
  };
}

/**
 * Build the connector-health report for a project from oauth_connections and the
 * latest attribution metric's per-source availability.
 */
export async function getConnectorHealth(
  supabase: SupabaseClient,
  projectId: string
): Promise<ConnectorHealthReport> {
  const { data: connections } = await supabase
    .from("oauth_connections")
    .select("provider, access_token, expires_at, updated_at")
    .eq("project_id", projectId);

  // Latest attribution run tells us which sources actually returned data.
  const { data: latestMetric } = await supabase
    .from("attribution_metrics")
    .select("source_availability, last_checked_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const availability = (latestMetric?.source_availability as Record<string, boolean> | null) || {};
  const lastChecked = (latestMetric?.last_checked_at as string | null) || null;

  return deriveConnectorReport(projectId, (connections || []) as ConnectionRow[], availability, lastChecked);
}

/**
 * Hard gate used before locking an outcome-guarantee baseline. Returns whether
 * the project is eligible and a human-readable reason.
 */
export async function isOutcomeGuaranteeEligible(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ eligible: boolean; reason: string }> {
  const report = await getConnectorHealth(supabase, projectId);
  return { eligible: report.outcomeGuaranteeEligible, reason: report.reason };
}
