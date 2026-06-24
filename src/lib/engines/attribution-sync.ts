import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateAttribution, syncGoogleSearchConsole, syncBingWebmaster, syncGoogleAnalytics, syncPlausible } from "@/lib/engines/attribution";
import { getValidOAuthToken } from "@/lib/oauth/tokens";

export async function syncProjectAttribution(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ success: boolean; error?: string }> {
  const { data: project } = await supabase.from("projects").select("*").eq("id", projectId).single();
  if (!project) return { error: "Project not found", success: false };

  const periodEnd = new Date().toISOString().split("T")[0];
  const periodStart = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

  let organicTraffic = 0;
  let searchClicks = 0;
  let aiReferralTraffic = 0;
  let leads = 0;
  let revenue = 0;

  const gscToken = await getValidOAuthToken(supabase, projectId, "google_search_console");
  if (gscToken) {
    const gscData = await syncGoogleSearchConsole(projectId, gscToken, project.domain, periodStart, periodEnd);
    organicTraffic += gscData.clicks;
    searchClicks = gscData.clicks;
  }

  const bingToken = await getValidOAuthToken(supabase, projectId, "bing_webmaster");
  if (bingToken) {
    const bingData = await syncBingWebmaster(bingToken, project.domain);
    organicTraffic += bingData.clicks;
    searchClicks += bingData.clicks;
    aiReferralTraffic += bingData.aiCitations;
  }

  const ga4Token = await getValidOAuthToken(supabase, projectId, "google_analytics");
  if (ga4Token) {
    const { data: ga4Conn } = await supabase
      .from("oauth_connections")
      .select("metadata")
      .eq("project_id", projectId)
      .eq("provider", "google_analytics")
      .single();

    const propertyId = (ga4Conn?.metadata as { property_id?: string } | null)?.property_id;
    if (propertyId) {
      const ga4Data = await syncGoogleAnalytics(ga4Token, propertyId, periodStart, periodEnd);
      organicTraffic += ga4Data.sessions;
      aiReferralTraffic += ga4Data.aiReferrals;
      leads += ga4Data.leads;
      revenue += ga4Data.revenue;
    }
  }

  const { data: plausibleConn } = await supabase
    .from("oauth_connections")
    .select("access_token, metadata")
    .eq("project_id", projectId)
    .eq("provider", "plausible")
    .single();

  if (plausibleConn?.access_token) {
    const siteId = (plausibleConn.metadata as { site_id?: string } | null)?.site_id || project.domain;
    const plausibleData = await syncPlausible(plausibleConn.access_token, siteId);
    organicTraffic += plausibleData.visitors;
    aiReferralTraffic += plausibleData.aiReferrals;
  }

  const metric = calculateAttribution(
    projectId,
    {
      organicTraffic,
      aiReferralTraffic,
      socialClicks: 0,
      directoryReferrals: 0,
      searchClicks,
      leads,
      calls: 0,
      bookings: 0,
      purchases: 0,
      revenue,
      monthlyAdSpend: project.monthly_ad_spend ?? undefined,
      industry: project.industry ?? undefined,
    },
    periodStart,
    periodEnd
  );

  await supabase.from("attribution_metrics").insert(metric);
  return { success: true };
}
