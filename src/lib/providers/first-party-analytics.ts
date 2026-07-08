import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidOAuthToken } from "@/lib/oauth/tokens";
import { syncGoogleSearchConsole, syncBingWebmaster, syncGoogleAnalytics } from "@/lib/engines/attribution";

/**
 * Patch I — official first-party analytics connectors (Google Search Console,
 * GA4, Bing Webmaster).
 *
 * This is a thin, canonical read surface, NOT a new fetch implementation: the
 * actual API calls already exist and are already tested in
 * `@/lib/engines/attribution.ts` (`syncGoogleSearchConsole`,
 * `syncGoogleAnalytics`, `syncBingWebmaster`) and are already wired into the
 * attribution pipeline (`@/lib/engines/attribution-sync.ts`). What was
 * missing was ONE place a caller could ask "give me this project's real
 * official GSC/GA4/Bing numbers" without re-deriving the
 * `getValidOAuthToken()` + `oauth_connections.metadata` (GA4 property id)
 * lookup dance that `attribution-sync.ts`, `/api/gsc`, and `/api/roi` each
 * currently hand-roll independently.
 *
 * Contract (mirrors `services/omnidata/src/engines/keyword-planner.ts`'s
 * `getKeywordMetrics()` — "return null, never a guess" — exactly as this
 * plan's Patch I requires): every function here returns `null` when the
 * project hasn't connected that source, hasn't finished configuring it (e.g.
 * GA4 with no property selected), or the live call failed. It never returns
 * zeros dressed up as real data.
 */

export interface AnalyticsWindow {
  periodStart: string;
  periodEnd: string;
}

export interface SearchConsoleSnapshot extends AnalyticsWindow {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface Ga4Snapshot extends AnalyticsWindow {
  propertyId: string;
  sessions: number;
  aiReferrals: number;
  leads: number;
  revenue: number;
}

export interface BingWebmasterSnapshot extends AnalyticsWindow {
  clicks: number;
  impressions: number;
  aiCitations: number;
}

function defaultWindow(days = 28): AnalyticsWindow {
  const end = new Date();
  const start = new Date(Date.now() - days * 86_400_000);
  return {
    periodStart: start.toISOString().split("T")[0],
    periodEnd: end.toISOString().split("T")[0],
  };
}

/**
 * Real Google Search Console clicks/impressions/CTR/position for this
 * project's domain. Returns null when GSC isn't connected for this project or
 * the live query fails — never a fabricated/zeroed snapshot.
 */
export async function getSearchConsoleSnapshot(
  supabase: SupabaseClient,
  projectId: string,
  domain: string,
  window: Partial<AnalyticsWindow> = {}
): Promise<SearchConsoleSnapshot | null> {
  const token = await getValidOAuthToken(supabase, projectId, "google_search_console");
  if (!token) return null;

  const { periodStart, periodEnd } = { ...defaultWindow(), ...window };
  const result = await syncGoogleSearchConsole(projectId, token, domain, periodStart, periodEnd);
  if (!result.available) return null;

  return {
    clicks: result.clicks,
    impressions: result.impressions,
    ctr: result.ctr,
    position: result.position,
    periodStart,
    periodEnd,
  };
}

/**
 * Real GA4 sessions/leads/revenue for this project. Returns null when GA4
 * isn't connected, or is connected but no property has been selected yet
 * (the oauth_connections.metadata.property_id set by the GA4 OAuth callback
 * / `/api/attribution/ga4-properties`), or the live report call fails.
 */
export async function getGa4Snapshot(
  supabase: SupabaseClient,
  projectId: string,
  window: Partial<AnalyticsWindow> = {}
): Promise<Ga4Snapshot | null> {
  const token = await getValidOAuthToken(supabase, projectId, "google_analytics");
  if (!token) return null;

  const { data: conn } = await supabase
    .from("oauth_connections")
    .select("metadata")
    .eq("project_id", projectId)
    .eq("provider", "google_analytics")
    .maybeSingle();
  const propertyId = (conn?.metadata as { property_id?: string } | null)?.property_id;
  if (!propertyId) return null;

  const { periodStart, periodEnd } = { ...defaultWindow(), ...window };
  const result = await syncGoogleAnalytics(token, propertyId, periodStart, periodEnd);
  if (!result.available) return null;

  return {
    propertyId,
    sessions: result.sessions,
    aiReferrals: result.aiReferrals,
    leads: result.leads,
    revenue: result.revenue,
    periodStart,
    periodEnd,
  };
}

/**
 * Real Bing Webmaster clicks/impressions for this project's domain. Returns
 * null when Bing isn't connected for this project or the live query fails.
 */
export async function getBingWebmasterSnapshot(
  supabase: SupabaseClient,
  projectId: string,
  domain: string,
  window: Partial<AnalyticsWindow> = {}
): Promise<BingWebmasterSnapshot | null> {
  const token = await getValidOAuthToken(supabase, projectId, "bing_webmaster");
  if (!token) return null;

  const { periodStart, periodEnd } = { ...defaultWindow(), ...window };
  const result = await syncBingWebmaster(token, domain);
  if (!result.available) return null;

  return {
    clicks: result.clicks,
    impressions: result.impressions,
    aiCitations: result.aiCitations,
    periodStart,
    periodEnd,
  };
}
