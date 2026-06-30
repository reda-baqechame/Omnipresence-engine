import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateAttribution, syncGoogleSearchConsole, syncBingWebmaster, syncGoogleAnalytics, syncPlausible } from "@/lib/engines/attribution";
import { fetchBingAIPerformance } from "@/lib/providers/bing-webmaster";
import { getValidOAuthToken } from "@/lib/oauth/tokens";
import { syncPostHog, hasPostHogCapability } from "@/lib/providers/posthog";
import {
  syncStripeRevenue,
  syncShopifyRevenue,
  syncCalendlyBookings,
  syncHubspotCrm,
  syncGbpPerformance,
} from "@/lib/engines/revenue-connectors";
import {
  syncGoogleAdsSpend,
  syncMetaAdsSpend,
  syncLinkedInAdsSpend,
  blendAdSpend,
  type AdSpendResult,
} from "@/lib/engines/ad-connectors";

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
  let socialClicks = 0;
  let directoryReferrals = 0;
  let leads = 0;
  let revenue = 0;
  let calls = 0;
  let bookings = 0;
  let purchases = 0;

  // Track which real sources actually returned data so a failed sync is shown
  // as Unavailable rather than a confident zero.
  const sourceAvailability: Record<string, boolean> = {};

  // Edge-detected AI referrals from beacon
  const { count: beaconAiHits } = await supabase
    .from("ai_referrals")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .gte("created_at", periodStart);

  aiReferralTraffic += beaconAiHits || 0;
  sourceAvailability.beacon = true;

  const gscToken = await getValidOAuthToken(supabase, projectId, "google_search_console");
  if (gscToken) {
    const gscData = await syncGoogleSearchConsole(projectId, gscToken, project.domain, periodStart, periodEnd);
    organicTraffic += gscData.clicks;
    searchClicks = gscData.clicks;
    sourceAvailability.google_search_console = gscData.available;
  }

  const bingToken = await getValidOAuthToken(supabase, projectId, "bing_webmaster");
  if (bingToken) {
    const bingData = await syncBingWebmaster(bingToken, project.domain);
    organicTraffic += bingData.clicks;
    searchClicks += bingData.clicks;
    aiReferralTraffic += bingData.aiCitations;
    sourceAvailability.bing_webmaster = bingData.available;

    const aiPerf = await fetchBingAIPerformance(bingToken, `https://${project.domain}`);
    if (aiPerf.success && aiPerf.data) {
      aiReferralTraffic += aiPerf.data.citations;
    }
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
      sourceAvailability.google_analytics = ga4Data.available;
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
    sourceAvailability.plausible = plausibleData.available;
  }

  // First-party analytics (self-hosted PostHog, GA4-free). Per-project config may
  // be stored in oauth_connections.metadata; otherwise the global Railway instance.
  const { data: posthogConn } = await supabase
    .from("oauth_connections")
    .select("access_token, metadata")
    .eq("project_id", projectId)
    .eq("provider", "posthog")
    .maybeSingle();

  if (hasPostHogCapability() || posthogConn?.access_token) {
    const meta = (posthogConn?.metadata as { project_id?: string; host?: string } | null) || {};
    const phData = await syncPostHog(30, {
      apiKey: posthogConn?.access_token || undefined,
      projectId: meta.project_id,
      host: meta.host,
    });
    if (phData.available) {
      organicTraffic += phData.searchVisits;
      aiReferralTraffic += phData.aiReferrals;
      socialClicks += phData.socialClicks;
    }
    sourceAvailability.posthog = phData.available;
  }

  const periodStartMs = new Date(`${periodStart}T00:00:00Z`).getTime();

  // First-party revenue (Stripe) — restricted key stored as the connection token.
  const { data: stripeConn } = await supabase
    .from("oauth_connections")
    .select("access_token")
    .eq("project_id", projectId)
    .eq("provider", "stripe")
    .maybeSingle();
  if (stripeConn?.access_token) {
    const stripeData = await syncStripeRevenue(stripeConn.access_token, Math.floor(periodStartMs / 1000));
    purchases += stripeData.purchases;
    revenue += stripeData.revenue;
    sourceAvailability.stripe = stripeData.available;
  }

  // First-party revenue (Shopify) — Admin API token + shop in metadata.
  const { data: shopifyConn } = await supabase
    .from("oauth_connections")
    .select("access_token, metadata")
    .eq("project_id", projectId)
    .eq("provider", "shopify")
    .maybeSingle();
  if (shopifyConn?.access_token) {
    const shop = (shopifyConn.metadata as { shop?: string } | null)?.shop || project.domain;
    const shopifyData = await syncShopifyRevenue(shop, shopifyConn.access_token, `${periodStart}T00:00:00Z`);
    purchases += shopifyData.purchases;
    revenue += shopifyData.revenue;
    sourceAvailability.shopify = shopifyData.available;
  }

  // Bookings (Calendly).
  const { data: calendlyConn } = await supabase
    .from("oauth_connections")
    .select("access_token")
    .eq("project_id", projectId)
    .eq("provider", "calendly")
    .maybeSingle();
  if (calendlyConn?.access_token) {
    const calendlyData = await syncCalendlyBookings(
      calendlyConn.access_token,
      `${periodStart}T00:00:00Z`,
      `${periodEnd}T23:59:59Z`
    );
    bookings += calendlyData.bookings;
    sourceAvailability.calendly = calendlyData.available;
  }

  // CRM leads + pipeline (HubSpot).
  const hubspotToken = await getValidOAuthToken(supabase, projectId, "hubspot");
  if (hubspotToken) {
    const hubspotData = await syncHubspotCrm(hubspotToken, periodStartMs);
    leads += hubspotData.leads;
    revenue += hubspotData.wonValue;
    sourceAvailability.hubspot = hubspotData.available;
  }

  // Google Business Profile performance (calls / website clicks / directions).
  const gbpToken = await getValidOAuthToken(supabase, projectId, "google_business_profile");
  if (gbpToken) {
    const { data: gbpConn } = await supabase
      .from("oauth_connections")
      .select("metadata")
      .eq("project_id", projectId)
      .eq("provider", "google_business_profile")
      .maybeSingle();
    const locationId = (gbpConn?.metadata as { location_id?: string } | null)?.location_id;
    if (locationId) {
      const toYmd = (d: string) => {
        const [year, month, day] = d.split("-").map((n) => parseInt(n, 10));
        return { year, month, day };
      };
      const gbpData = await syncGbpPerformance(gbpToken, locationId, toYmd(periodStart), toYmd(periodEnd));
      calls += gbpData.calls;
      socialClicks += gbpData.websiteClicks;
      sourceAvailability.google_business_profile = gbpData.available;
    }
  }

  // Revenue & leads come from GA4 + first-party money connectors. If none of the
  // monetary sources worked this run, the $ figure is NOT measured — flag it so
  // the ROI view shows "—" instead of a refund-triggering confident $0.
  const revenueAvailable =
    sourceAvailability.google_analytics === true ||
    sourceAvailability.stripe === true ||
    sourceAvailability.shopify === true ||
    sourceAvailability.hubspot === true;

  const { data: coverageLive } = await supabase
    .from("coverage_items")
    .select("submission_status")
    .eq("project_id", projectId)
    .eq("submission_status", "live");
  directoryReferrals = (coverageLive || []).length;

  // Ad-account import (Wave S2): real CPC/spend to replace modeled benchmarks.
  const toYmdParts = (d: string) => {
    const [year, month, day] = d.split("-").map((n) => parseInt(n, 10));
    return { year, month, day };
  };
  const adResults: AdSpendResult[] = [];

  const googleAdsToken = await getValidOAuthToken(supabase, projectId, "google_ads");
  if (googleAdsToken && process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    const { data: gAdsConn } = await supabase
      .from("oauth_connections")
      .select("metadata")
      .eq("project_id", projectId)
      .eq("provider", "google_ads")
      .maybeSingle();
    const meta = (gAdsConn?.metadata as { customer_id?: string; login_customer_id?: string } | null) || {};
    if (meta.customer_id) {
      adResults.push(
        await syncGoogleAdsSpend(
          {
            accessToken: googleAdsToken,
            developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
            customerId: meta.customer_id,
            loginCustomerId: meta.login_customer_id,
          },
          periodStart,
          periodEnd
        )
      );
    }
  }

  const { data: metaAdsConn } = await supabase
    .from("oauth_connections")
    .select("access_token, metadata")
    .eq("project_id", projectId)
    .eq("provider", "meta_ads")
    .maybeSingle();
  if (metaAdsConn?.access_token) {
    const adAccountId = (metaAdsConn.metadata as { ad_account_id?: string } | null)?.ad_account_id;
    if (adAccountId) {
      adResults.push(await syncMetaAdsSpend(metaAdsConn.access_token, adAccountId, periodStart, periodEnd));
    }
  }

  const { data: liAdsConn } = await supabase
    .from("oauth_connections")
    .select("access_token, metadata")
    .eq("project_id", projectId)
    .eq("provider", "linkedin_ads")
    .maybeSingle();
  if (liAdsConn?.access_token) {
    const accountId = (liAdsConn.metadata as { account_id?: string } | null)?.account_id;
    if (accountId) {
      adResults.push(
        await syncLinkedInAdsSpend(liAdsConn.access_token, accountId, toYmdParts(periodStart), toYmdParts(periodEnd))
      );
    }
  }

  const blended = blendAdSpend(adResults);
  for (const r of adResults) sourceAvailability[r.network] = r.available;

  const metric = calculateAttribution(
    projectId,
    {
      organicTraffic,
      aiReferralTraffic,
      socialClicks,
      directoryReferrals,
      searchClicks,
      leads,
      calls,
      bookings,
      purchases,
      revenue,
      monthlyAdSpend: blended.available ? blended.spend : project.monthly_ad_spend ?? undefined,
      industry: project.industry ?? undefined,
      realCpc: blended.available ? blended.blendedCpc : undefined,
      paidSpend: blended.available ? blended.spend : undefined,
      paidConversions: blended.available ? blended.conversions : undefined,
    },
    periodStart,
    periodEnd
  );

  // A connected source that failed (available === false) makes the metric only
  // partially trustworthy; no connected real source at all = unavailable.
  const connectedSources = Object.keys(sourceAvailability).filter((k) => k !== "beacon");
  const anyConnectedAvailable = connectedSources.some((k) => sourceAvailability[k]);
  const anyConnectedFailed = connectedSources.some((k) => !sourceAvailability[k]);

  await supabase.from("attribution_metrics").insert({
    ...metric,
    source_availability: { ...sourceAvailability, revenue: revenueAvailable },
    data_source: anyConnectedAvailable ? "measured" : "unavailable",
    is_estimated: anyConnectedFailed || connectedSources.length === 0,
    confidence: connectedSources.length
      ? Math.round((connectedSources.filter((k) => sourceAvailability[k]).length / connectedSources.length) * 100) / 100
      : 0,
    last_checked_at: new Date().toISOString(),
  });
  return { success: true };
}
