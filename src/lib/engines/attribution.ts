import type { AttributionMetric } from "@/types/database";
import { logProviderError } from "@/lib/observability/log";
import { fetchWithTimeout } from "@/lib/providers/http";
import { computeMoneyMath } from "@/lib/engines/ad-connectors";

export interface AttributionInputs {
  organicTraffic: number;
  aiReferralTraffic: number;
  socialClicks: number;
  directoryReferrals: number;
  searchClicks: number;
  leads: number;
  calls: number;
  bookings: number;
  purchases: number;
  revenue: number;
  monthlyAdSpend?: number;
  industry?: string;
  /**
   * Real blended CPC imported from connected ad accounts (Google/Meta/LinkedIn).
   * When present this replaces the modeled CPC_BENCHMARKS so paid-equivalent
   * value is measured, not estimated.
   */
  realCpc?: number;
  /** Real paid spend in the window (sum across connected ad accounts). */
  paidSpend?: number;
  /** Real paid conversions in the window (for CAC). */
  paidConversions?: number;
}

// Industry-average CPC benchmarks for paid-ads-equivalent calculation
const CPC_BENCHMARKS: Record<string, number> = {
  legal: 15.0,
  dental: 8.0,
  medical: 10.0,
  saas: 5.0,
  ecommerce: 2.5,
  real_estate: 6.0,
  roofing: 12.0,
  plumbing: 7.0,
  default: 4.0,
};

export function calculateAttribution(
  projectId: string,
  inputs: AttributionInputs,
  periodStart: string,
  periodEnd: string
): Omit<AttributionMetric, "id" | "created_at"> {
  // Prefer the real blended CPC imported from connected ad accounts; fall back
  // to the industry benchmark (clearly labeled via cpc_source).
  const hasRealCpc = typeof inputs.realCpc === "number" && inputs.realCpc > 0;
  const cpc = hasRealCpc
    ? (inputs.realCpc as number)
    : CPC_BENCHMARKS[inputs.industry?.toLowerCase() || "default"] || CPC_BENCHMARKS.default;

  const totalOrganicClicks =
    inputs.organicTraffic + inputs.aiReferralTraffic + inputs.socialClicks + inputs.directoryReferrals;

  const money = computeMoneyMath({
    organicClicks: totalOrganicClicks,
    searchClicks: inputs.searchClicks,
    cpc,
    purchases: inputs.purchases,
    revenue: inputs.revenue,
    paidSpend: inputs.paidSpend,
    paidConversions: inputs.paidConversions,
  });
  const paidAdsEquivalent = money.paidAdsEquivalent;

  const totalConversions = inputs.leads + inputs.calls + inputs.bookings + inputs.purchases;
  const conversionRate = totalOrganicClicks > 0 ? totalConversions / totalOrganicClicks : 0;

  const adSpendSavings = inputs.monthlyAdSpend
    ? Math.max(0, inputs.monthlyAdSpend - paidAdsEquivalent * 0.3)
    : paidAdsEquivalent * 0.5;

  return {
    project_id: projectId,
    period_start: periodStart,
    period_end: periodEnd,
    organic_traffic: inputs.organicTraffic,
    ai_referral_traffic: inputs.aiReferralTraffic,
    social_clicks: inputs.socialClicks,
    directory_referrals: inputs.directoryReferrals,
    search_clicks: inputs.searchClicks,
    leads: inputs.leads,
    calls: inputs.calls,
    bookings: inputs.bookings,
    purchases: inputs.purchases,
    revenue: inputs.revenue,
    paid_ads_equivalent: Math.round(paidAdsEquivalent * 100) / 100,
    source_breakdown: {
      organic: inputs.organicTraffic,
      ai_referrals: inputs.aiReferralTraffic,
      social: inputs.socialClicks,
      directories: inputs.directoryReferrals,
      search: inputs.searchClicks,
      conversion_rate: Math.round(conversionRate * 10000) / 100,
      ad_spend_savings: Math.round(adSpendSavings * 100) / 100,
      cpc_used: Math.round(cpc * 100) / 100,
      // 1 = real imported CPC, 0 = modeled benchmark (drives provenance UI).
      cpc_is_real: hasRealCpc ? 1 : 0,
      paid_spend: Math.round((inputs.paidSpend || 0) * 100) / 100,
      paid_conversions: inputs.paidConversions || 0,
      paid_cac: money.paidCac,
      customer_ltv: money.customerLtv,
      ltv_to_cac: money.ltvToCac,
      revenue_influenced: money.revenueInfluenced,
    },
  };
}

export type AttributionModel =
  | "first_touch"
  | "last_touch"
  | "linear"
  | "position_based";

export interface ChannelCredit {
  channel: string;
  credit: number;
  percent: number;
}

/**
 * True multi-touch attribution from ordered conversion paths (each path is the
 * sequence of channels a converting user touched). Supports first/last-touch,
 * linear, and position-based (40/20/40 U-shaped) models.
 */
export function computeMultiTouchAttribution(
  paths: string[][],
  model: AttributionModel
): ChannelCredit[] {
  const credit = new Map<string, number>();
  const add = (channel: string, value: number) =>
    credit.set(channel, (credit.get(channel) || 0) + value);

  for (const path of paths) {
    if (!path.length) continue;
    if (model === "first_touch") {
      add(path[0], 1);
    } else if (model === "last_touch") {
      add(path[path.length - 1], 1);
    } else if (model === "linear") {
      const share = 1 / path.length;
      for (const c of path) add(c, share);
    } else {
      // position_based: 40% first, 40% last, 20% spread across middle.
      if (path.length === 1) {
        add(path[0], 1);
      } else if (path.length === 2) {
        add(path[0], 0.5);
        add(path[1], 0.5);
      } else {
        add(path[0], 0.4);
        add(path[path.length - 1], 0.4);
        const middle = path.slice(1, -1);
        const share = 0.2 / middle.length;
        for (const c of middle) add(c, share);
      }
    }
  }

  const total = [...credit.values()].reduce((a, b) => a + b, 0) || 1;
  return [...credit.entries()]
    .map(([channel, value]) => ({
      channel,
      credit: Math.round(value * 100) / 100,
      percent: Math.round((value / total) * 1000) / 10,
    }))
    .sort((a, b) => b.credit - a.credit);
}

/**
 * Modeled multi-touch breakdown from channel-level aggregates (when per-user
 * paths aren't available). Discovery channels (AI/organic/social/directories)
 * are weighted toward first-touch; intent channels (search) toward last-touch.
 * Clearly a model, not raw paths.
 */
export function modelChannelAttribution(
  channelTotals: Record<string, number>
): Record<AttributionModel, ChannelCredit[]> {
  const entries = Object.entries(channelTotals).filter(([, v]) => v > 0);
  const grand = entries.reduce((a, [, v]) => a + v, 0) || 1;

  const discovery = new Set(["ai_referrals", "organic", "social", "directories"]);
  const intent = new Set(["search", "direct"]);

  const toCredits = (weightFn: (channel: string, vol: number) => number): ChannelCredit[] => {
    const weighted = entries.map(([c, v]) => [c, weightFn(c, v)] as const);
    const total = weighted.reduce((a, [, w]) => a + w, 0) || 1;
    return weighted
      .map(([channel, w]) => ({
        channel,
        credit: Math.round((w / total) * grand),
        percent: Math.round((w / total) * 1000) / 10,
      }))
      .sort((a, b) => b.credit - a.credit);
  };

  return {
    linear: toCredits((_, v) => v),
    first_touch: toCredits((c, v) => v * (discovery.has(c) ? 1.6 : 0.6)),
    last_touch: toCredits((c, v) => v * (intent.has(c) ? 1.8 : 0.7)),
    position_based: toCredits((c, v) =>
      v * (discovery.has(c) ? 1.3 : intent.has(c) ? 1.3 : 0.9)
    ),
  };
}

export function calculateMoMDelta(
  current: AttributionMetric,
  previous: AttributionMetric
): Record<string, { value: number; change: number; changePercent: number }> {
  const metrics = [
    "organic_traffic", "ai_referral_traffic", "social_clicks",
    "directory_referrals", "leads", "revenue", "paid_ads_equivalent",
  ] as const;

  const delta: Record<string, { value: number; change: number; changePercent: number }> = {};

  for (const metric of metrics) {
    const curr = current[metric] as number;
    const prev = previous[metric] as number;
    const change = curr - prev;
    const changePercent = prev > 0 ? (change / prev) * 100 : curr > 0 ? 100 : 0;

    delta[metric] = {
      value: curr,
      change,
      changePercent: Math.round(changePercent * 10) / 10,
    };
  }

  return delta;
}

export async function syncGoogleSearchConsole(
  projectId: string,
  accessToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string
): Promise<{ clicks: number; impressions: number; ctr: number; position: number; available: boolean }> {
  try {
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ["date"],
        rowLimit: 1000,
      }),
    });

    if (!response.ok) throw new Error(`GSC API error: ${response.status}`);

    const data = (await response.json()) as {
      rows: Array<{ clicks: number; impressions: number; ctr: number; position: number }>;
    };

    const totals = (data.rows || []).reduce(
      (acc, row) => ({
        clicks: acc.clicks + row.clicks,
        impressions: acc.impressions + row.impressions,
        ctr: 0,
        position: 0,
      }),
      { clicks: 0, impressions: 0, ctr: 0, position: 0 }
    );

    totals.ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
    return { ...totals, available: true };
  } catch {
    // Provider failed — report unavailable so attribution is not a false zero.
    return { clicks: 0, impressions: 0, ctr: 0, position: 0, available: false };
  }
}

export async function syncBingWebmaster(
  accessToken: string,
  siteUrl: string
): Promise<{ clicks: number; impressions: number; aiCitations: number; available: boolean }> {
  try {
    const response = await fetchWithTimeout(
      `https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats?siteUrl=${encodeURIComponent(siteUrl)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) throw new Error(`Bing API error: ${response.status}`);

    const data = (await response.json()) as {
      d: Array<{ Clicks: number; Impressions: number }>;
    };

    const totals = (data.d || []).reduce(
      (acc, row) => ({
        clicks: acc.clicks + row.Clicks,
        impressions: acc.impressions + row.Impressions,
      }),
      { clicks: 0, impressions: 0 }
    );

    return { ...totals, aiCitations: 0, available: true };
  } catch {
    return { clicks: 0, impressions: 0, aiCitations: 0, available: false };
  }
}

const AI_REFERRAL_SOURCES = [
  "chatgpt",
  "chat.openai",
  "openai",
  "perplexity",
  "gemini",
  "google bard",
  "bard",
  "claude",
  "anthropic",
  "copilot",
  "bing.com/chat",
  "you.com",
  "phind",
  "poe.com",
  "meta.ai",
  "groq",
];

const AI_REFERRAL_REGEX = /chatgpt|openai|perplexity|gemini|bard|claude|anthropic|copilot|you\.com|phind|poe\.com|meta\.ai/i;

export function isAiReferralSource(source: string): boolean {
  const s = source.toLowerCase();
  return AI_REFERRAL_SOURCES.some((ref) => s.includes(ref)) || AI_REFERRAL_REGEX.test(s);
}

export async function discoverGa4Property(
  accessToken: string,
  domain: string
): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) return null;

    const data = (await response.json()) as {
      accountSummaries?: Array<{
        propertySummaries?: Array<{ property: string; displayName?: string }>;
      }>;
    };

    const domainRoot = domain.replace(/^www\./, "").split(".")[0].toLowerCase();

    for (const account of data.accountSummaries || []) {
      for (const prop of account.propertySummaries || []) {
        const name = (prop.displayName || "").toLowerCase();
        if (name.includes(domainRoot)) return prop.property;
      }
    }

    return data.accountSummaries?.[0]?.propertySummaries?.[0]?.property || null;
  } catch {
    return null;
  }
}

export interface Ga4AiSourceRow {
  source: string;
  sessions: number;
  conversions: number;
  revenue: number;
}

export async function syncGoogleAnalytics(
  accessToken: string,
  propertyId: string,
  startDate: string,
  endDate: string
): Promise<{
  sessions: number;
  aiReferrals: number;
  leads: number;
  revenue: number;
  /** Conversions attributed to AI-referred sessions (GA4 sessionSource). */
  aiLeads: number;
  /** Revenue attributed to AI-referred sessions (GA4 sessionSource). */
  aiRevenue: number;
  /** Per-AI-source rows (chatgpt.com, perplexity.ai, ...) sorted by sessions. */
  aiSources: Ga4AiSourceRow[];
  available: boolean;
}> {
  try {
    const response = await fetchWithTimeout(
      `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateRanges: [{ startDate, endDate }],
          metrics: [
            { name: "sessions" },
            { name: "conversions" },
            { name: "totalRevenue" },
          ],
          dimensions: [{ name: "sessionSource" }],
        }),
      }
    );

    if (!response.ok) throw new Error(`GA4 API error: ${response.status}`);

    const data = (await response.json()) as {
      rows?: Array<{
        dimensionValues: Array<{ value: string }>;
        metricValues: Array<{ value: string }>;
      }>;
    };

    let sessions = 0;
    let aiReferrals = 0;
    let leads = 0;
    let revenue = 0;
    let aiLeads = 0;
    let aiRevenue = 0;
    const aiSources: Ga4AiSourceRow[] = [];

    for (const row of data.rows || []) {
      const source = row.dimensionValues[0]?.value?.toLowerCase() || "";
      const rowSessions = parseInt(row.metricValues[0]?.value || "0", 10);
      const rowConversions = parseInt(row.metricValues[1]?.value || "0", 10);
      const rowRevenue = parseFloat(row.metricValues[2]?.value || "0");

      sessions += rowSessions;
      leads += rowConversions;
      revenue += rowRevenue;

      if (isAiReferralSource(source)) {
        aiReferrals += rowSessions;
        aiLeads += rowConversions;
        aiRevenue += rowRevenue;
        aiSources.push({
          source,
          sessions: rowSessions,
          conversions: rowConversions,
          revenue: Math.round(rowRevenue * 100) / 100,
        });
      }
    }

    aiSources.sort((a, b) => b.sessions - a.sessions);
    return {
      sessions,
      aiReferrals,
      leads,
      revenue,
      aiLeads,
      aiRevenue: Math.round(aiRevenue * 100) / 100,
      aiSources,
      available: true,
    };
  } catch (error) {
    // Refund-safety: a failed GA4 call must NOT read as a confident $0 revenue.
    logProviderError("attribution.ga4", error, { propertyId });
    return {
      sessions: 0,
      aiReferrals: 0,
      leads: 0,
      revenue: 0,
      aiLeads: 0,
      aiRevenue: 0,
      aiSources: [],
      available: false,
    };
  }
}

export interface LandingPageRevenue {
  landingPage: string;
  sessions: number;
  conversions: number;
  revenue: number;
}

/**
 * Revenue + conversions broken down by landing page (GA4). Powers the ROI
 * command center's "which page makes money" view.
 */
export async function syncGa4LandingPages(
  accessToken: string,
  propertyId: string,
  startDate: string,
  endDate: string,
  limit = 50
): Promise<LandingPageRevenue[]> {
  try {
    const response = await fetchWithTimeout(
      `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateRanges: [{ startDate, endDate }],
          metrics: [{ name: "sessions" }, { name: "conversions" }, { name: "totalRevenue" }],
          dimensions: [{ name: "landingPagePlusQueryString" }],
          orderBys: [{ metric: { metricName: "totalRevenue" }, desc: true }],
          limit,
        }),
      }
    );
    if (!response.ok) return [];

    const data = (await response.json()) as {
      rows?: Array<{
        dimensionValues: Array<{ value: string }>;
        metricValues: Array<{ value: string }>;
      }>;
    };

    return (data.rows || []).map((row) => ({
      landingPage: row.dimensionValues[0]?.value || "(not set)",
      sessions: parseInt(row.metricValues[0]?.value || "0", 10),
      conversions: parseInt(row.metricValues[1]?.value || "0", 10),
      revenue: parseFloat(row.metricValues[2]?.value || "0"),
    }));
  } catch {
    return [];
  }
}

export interface Ga4PropertyOption {
  id: string;
  displayName: string;
}

export async function listGa4Properties(accessToken: string): Promise<Ga4PropertyOption[]> {
  try {
    const response = await fetchWithTimeout(
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) return [];

    const data = (await response.json()) as {
      accountSummaries?: Array<{
        propertySummaries?: Array<{ property: string; displayName?: string }>;
      }>;
    };

    const properties: Ga4PropertyOption[] = [];
    for (const account of data.accountSummaries || []) {
      for (const prop of account.propertySummaries || []) {
        properties.push({
          id: prop.property,
          displayName: prop.displayName || prop.property,
        });
      }
    }
    return properties;
  } catch {
    return [];
  }
}

export async function syncPlausible(
  apiKey: string,
  siteId: string
): Promise<{ visitors: number; pageviews: number; aiReferrals: number; available: boolean }> {
  if (!apiKey || !siteId) {
    return { visitors: 0, pageviews: 0, aiReferrals: 0, available: false };
  }

  try {
    const baseUrl = process.env.PLAUSIBLE_API_URL || "https://plausible.io/api/v1/stats";
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    const aggregateRes = await fetchWithTimeout(
      `${baseUrl}/aggregate?site_id=${encodeURIComponent(siteId)}&period=30d&metrics=visitors,pageviews`,
      { headers }
    );
    if (!aggregateRes.ok) throw new Error(`Plausible aggregate error: ${aggregateRes.status}`);

    const aggregate = (await aggregateRes.json()) as {
      results: { visitors: { value: number }; pageviews: { value: number } };
    };

    const breakdownRes = await fetchWithTimeout(
      `${baseUrl}/breakdown?site_id=${encodeURIComponent(siteId)}&period=30d&property=visit:source&metrics=visitors&limit=50`,
      { headers }
    );

    let aiReferrals = 0;
    if (breakdownRes.ok) {
      const breakdown = (await breakdownRes.json()) as {
        results: Array<{ source: string; visitors: number }>;
      };
      for (const row of breakdown.results || []) {
        const source = row.source.toLowerCase();
        if (isAiReferralSource(source)) {
          aiReferrals += row.visitors;
        }
      }
    }

    return {
      visitors: aggregate.results?.visitors?.value || 0,
      pageviews: aggregate.results?.pageviews?.value || 0,
      aiReferrals,
      available: true,
    };
  } catch (error) {
    logProviderError("attribution.plausible", error, { siteId });
    return { visitors: 0, pageviews: 0, aiReferrals: 0, available: false };
  }
}
