import type { AttributionMetric } from "@/types/database";

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
  const cpc = CPC_BENCHMARKS[inputs.industry?.toLowerCase() || "default"] || CPC_BENCHMARKS.default;

  const totalOrganicClicks =
    inputs.organicTraffic + inputs.aiReferralTraffic + inputs.socialClicks + inputs.directoryReferrals;

  const paidAdsEquivalent = totalOrganicClicks * cpc;

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
      cpc_used: cpc,
    },
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
): Promise<{ clicks: number; impressions: number; ctr: number; position: number }> {
  try {
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    const response = await fetch(url, {
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
    return totals;
  } catch {
    return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  }
}

export async function syncBingWebmaster(
  accessToken: string,
  siteUrl: string
): Promise<{ clicks: number; impressions: number; aiCitations: number }> {
  try {
    const response = await fetch(
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

    return { ...totals, aiCitations: 0 };
  } catch {
    return { clicks: 0, impressions: 0, aiCitations: 0 };
  }
}

const AI_REFERRAL_SOURCES = [
  "chatgpt",
  "openai",
  "perplexity",
  "gemini",
  "google bard",
  "bard",
  "claude",
  "anthropic",
  "copilot",
  "bing.com/chat",
];

export async function discoverGa4Property(
  accessToken: string,
  domain: string
): Promise<string | null> {
  try {
    const response = await fetch(
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

export async function syncGoogleAnalytics(
  accessToken: string,
  propertyId: string,
  startDate: string,
  endDate: string
): Promise<{ sessions: number; aiReferrals: number; leads: number; revenue: number }> {
  try {
    const response = await fetch(
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

    for (const row of data.rows || []) {
      const source = row.dimensionValues[0]?.value?.toLowerCase() || "";
      const rowSessions = parseInt(row.metricValues[0]?.value || "0", 10);
      const rowConversions = parseInt(row.metricValues[1]?.value || "0", 10);
      const rowRevenue = parseFloat(row.metricValues[2]?.value || "0");

      sessions += rowSessions;
      leads += rowConversions;
      revenue += rowRevenue;

      if (AI_REFERRAL_SOURCES.some((s) => source.includes(s))) {
        aiReferrals += rowSessions;
      }
    }

    return { sessions, aiReferrals, leads, revenue };
  } catch {
    return { sessions: 0, aiReferrals: 0, leads: 0, revenue: 0 };
  }
}

export interface Ga4PropertyOption {
  id: string;
  displayName: string;
}

export async function listGa4Properties(accessToken: string): Promise<Ga4PropertyOption[]> {
  try {
    const response = await fetch(
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
): Promise<{ visitors: number; pageviews: number; aiReferrals: number }> {
  if (!apiKey || !siteId) {
    return { visitors: 0, pageviews: 0, aiReferrals: 0 };
  }

  try {
    const baseUrl = process.env.PLAUSIBLE_API_URL || "https://plausible.io/api/v1/stats";
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    const aggregateRes = await fetch(
      `${baseUrl}/aggregate?site_id=${encodeURIComponent(siteId)}&period=30d&metrics=visitors,pageviews`,
      { headers }
    );
    if (!aggregateRes.ok) throw new Error(`Plausible aggregate error: ${aggregateRes.status}`);

    const aggregate = (await aggregateRes.json()) as {
      results: { visitors: { value: number }; pageviews: { value: number } };
    };

    const breakdownRes = await fetch(
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
        if (AI_REFERRAL_SOURCES.some((s) => source.includes(s))) {
          aiReferrals += row.visitors;
        }
      }
    }

    return {
      visitors: aggregate.results?.visitors?.value || 0,
      pageviews: aggregate.results?.pageviews?.value || 0,
      aiReferrals,
    };
  } catch {
    return { visitors: 0, pageviews: 0, aiReferrals: 0 };
  }
}
