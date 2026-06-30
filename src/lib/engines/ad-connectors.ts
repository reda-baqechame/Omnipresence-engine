/**
 * Ad-account spend connectors (Wave S2).
 *
 * Imports REAL cost / clicks / conversions from connected Google, Meta, and
 * LinkedIn ad accounts so the platform can compute a measured blended CPC,
 * paid-equivalent value, CAC, and LTV:CAC instead of relying on the modeled
 * CPC_BENCHMARKS table. Every function returns an explicit `available` flag so a
 * failed import surfaces as Unavailable, never a confident zero.
 *
 * Self-contained (no `@/` alias imports) so the blending/parsing logic runs
 * directly under `node --test`.
 */

function fetchWithTimeout(
  input: string | URL,
  init: (RequestInit & { timeoutMs?: number }) = {}
): Promise<Response> {
  const { timeoutMs = 15000, signal, ...rest } = init;
  return fetch(input, { ...rest, signal: signal ?? AbortSignal.timeout(timeoutMs) });
}

function logAdError(scope: string, error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(JSON.stringify({ level: "warn", scope, message, ...context }));
}

export interface AdSpendResult {
  network: "google_ads" | "meta_ads" | "linkedin_ads";
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  avgCpc: number;
  available: boolean;
}

export interface GoogleAdsCreds {
  accessToken: string;
  developerToken: string;
  customerId: string;
  /** Manager (MCC) account id for the login-customer-id header, if any. */
  loginCustomerId?: string;
}

const empty = (network: AdSpendResult["network"]): AdSpendResult => ({
  network,
  spend: 0,
  clicks: 0,
  impressions: 0,
  conversions: 0,
  avgCpc: 0,
  available: false,
});

/**
 * Real Google Ads spend/clicks/conversions via the Google Ads REST API
 * (searchStream + GAQL). `customerId` is digits only (no dashes). Cost is in
 * micros; divide by 1e6 to get currency units.
 */
export async function syncGoogleAdsSpend(
  creds: GoogleAdsCreds,
  sinceIso: string,
  untilIso: string
): Promise<AdSpendResult> {
  if (!creds.accessToken || !creds.developerToken || !creds.customerId) return empty("google_ads");
  const cid = creds.customerId.replace(/-/g, "");
  try {
    const query = `SELECT metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM customer WHERE segments.date BETWEEN '${sinceIso}' AND '${untilIso}'`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${creds.accessToken}`,
      "developer-token": creds.developerToken,
      "Content-Type": "application/json",
    };
    if (creds.loginCustomerId) headers["login-customer-id"] = creds.loginCustomerId.replace(/-/g, "");

    const res = await fetchWithTimeout(
      `https://googleads.googleapis.com/v18/customers/${cid}/googleAds:searchStream`,
      { method: "POST", headers, body: JSON.stringify({ query }), timeoutMs: 20000 }
    );
    if (!res.ok) throw new Error(`Google Ads ${res.status}`);
    const json = (await res.json()) as Array<{
      results?: Array<{ metrics?: { costMicros?: string; clicks?: string; impressions?: string; conversions?: number } }>;
    }>;

    let costMicros = 0;
    let clicks = 0;
    let impressions = 0;
    let conversions = 0;
    for (const batch of json || []) {
      for (const row of batch.results || []) {
        costMicros += parseInt(row.metrics?.costMicros || "0", 10) || 0;
        clicks += parseInt(row.metrics?.clicks || "0", 10) || 0;
        impressions += parseInt(row.metrics?.impressions || "0", 10) || 0;
        conversions += Number(row.metrics?.conversions || 0) || 0;
      }
    }
    const spend = costMicros / 1e6;
    return {
      network: "google_ads",
      spend: Math.round(spend * 100) / 100,
      clicks,
      impressions,
      conversions: Math.round(conversions * 100) / 100,
      avgCpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
      available: true,
    };
  } catch (error) {
    logAdError("ads.google", error, { customerId: cid });
    return empty("google_ads");
  }
}

/**
 * Real Meta (Facebook/Instagram) ad spend via the Marketing API insights edge.
 * `adAccountId` is the act_… id (with or without the act_ prefix). Conversions
 * are summed from the actions array (purchase + lead + complete_registration).
 */
export async function syncMetaAdsSpend(
  accessToken: string,
  adAccountId: string,
  sinceIso: string,
  untilIso: string
): Promise<AdSpendResult> {
  if (!accessToken || !adAccountId) return empty("meta_ads");
  const actId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  try {
    const params = new URLSearchParams({
      access_token: accessToken,
      fields: "spend,clicks,impressions,cpc,actions",
      time_range: JSON.stringify({ since: sinceIso, until: untilIso }),
      level: "account",
    });
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/v19.0/${actId}/insights?${params.toString()}`,
      { timeoutMs: 15000 }
    );
    if (!res.ok) throw new Error(`Meta Ads ${res.status}`);
    const json = (await res.json()) as {
      data?: Array<{
        spend?: string;
        clicks?: string;
        impressions?: string;
        actions?: Array<{ action_type: string; value: string }>;
      }>;
    };

    let spend = 0;
    let clicks = 0;
    let impressions = 0;
    let conversions = 0;
    const conversionTypes = new Set(["purchase", "lead", "complete_registration", "offsite_conversion.fb_pixel_purchase"]);
    for (const row of json.data || []) {
      spend += parseFloat(row.spend || "0") || 0;
      clicks += parseInt(row.clicks || "0", 10) || 0;
      impressions += parseInt(row.impressions || "0", 10) || 0;
      for (const action of row.actions || []) {
        if (conversionTypes.has(action.action_type)) conversions += parseFloat(action.value || "0") || 0;
      }
    }
    return {
      network: "meta_ads",
      spend: Math.round(spend * 100) / 100,
      clicks,
      impressions,
      conversions: Math.round(conversions * 100) / 100,
      avgCpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
      available: true,
    };
  } catch (error) {
    logAdError("ads.meta", error, { adAccountId: actId });
    return empty("meta_ads");
  }
}

/**
 * Real LinkedIn ad spend via the Ad Analytics API. `accountId` is the numeric
 * sponsored-account id. Uses the analytics finder pivoted by ACCOUNT over the
 * window.
 */
export async function syncLinkedInAdsSpend(
  accessToken: string,
  accountId: string,
  since: { year: number; month: number; day: number },
  until: { year: number; month: number; day: number }
): Promise<AdSpendResult> {
  if (!accessToken || !accountId) return empty("linkedin_ads");
  const acct = accountId.replace(/\D/g, "");
  try {
    const params = new URLSearchParams({
      q: "analytics",
      pivot: "ACCOUNT",
      timeGranularity: "ALL",
      "dateRange.start.year": String(since.year),
      "dateRange.start.month": String(since.month),
      "dateRange.start.day": String(since.day),
      "dateRange.end.year": String(until.year),
      "dateRange.end.month": String(until.month),
      "dateRange.end.day": String(until.day),
      accounts: `urn:li:sponsoredAccount:${acct}`,
      fields: "costInLocalCurrency,clicks,impressions,externalWebsiteConversions",
    });
    const res = await fetchWithTimeout(
      `https://api.linkedin.com/rest/adAnalytics?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "LinkedIn-Version": "202405",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        timeoutMs: 15000,
      }
    );
    if (!res.ok) throw new Error(`LinkedIn Ads ${res.status}`);
    const json = (await res.json()) as {
      elements?: Array<{
        costInLocalCurrency?: string;
        clicks?: number;
        impressions?: number;
        externalWebsiteConversions?: number;
      }>;
    };

    let spend = 0;
    let clicks = 0;
    let impressions = 0;
    let conversions = 0;
    for (const el of json.elements || []) {
      spend += parseFloat(el.costInLocalCurrency || "0") || 0;
      clicks += el.clicks || 0;
      impressions += el.impressions || 0;
      conversions += el.externalWebsiteConversions || 0;
    }
    return {
      network: "linkedin_ads",
      spend: Math.round(spend * 100) / 100,
      clicks,
      impressions,
      conversions,
      avgCpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
      available: true,
    };
  } catch (error) {
    logAdError("ads.linkedin", error, { accountId: acct });
    return empty("linkedin_ads");
  }
}

export interface MoneyMathInput {
  /** Organic + AI + social + directory clicks (the surfaces we measure). */
  organicClicks: number;
  /** Paid/branded search clicks (for revenue-influence apportioning). */
  searchClicks: number;
  /** CPC to value organic clicks at (real blended CPC, else benchmark). */
  cpc: number;
  purchases: number;
  revenue: number;
  paidSpend?: number;
  paidConversions?: number;
}

export interface MoneyMath {
  paidAdsEquivalent: number;
  paidCac: number;
  customerLtv: number;
  ltvToCac: number;
  revenueInfluenced: number;
}

/**
 * Pure money math: paid-equivalent value of measured organic clicks, real CAC
 * from connected ad accounts, realized customer LTV, LTV:CAC, and the share of
 * revenue influenced by the measured (non-paid-search) surfaces.
 */
export function computeMoneyMath(input: MoneyMathInput): MoneyMath {
  const paidAdsEquivalent = Math.round(input.organicClicks * input.cpc * 100) / 100;
  const paidCac =
    input.paidSpend && input.paidConversions && input.paidConversions > 0
      ? Math.round((input.paidSpend / input.paidConversions) * 100) / 100
      : 0;
  const customerLtv = input.purchases > 0 ? Math.round((input.revenue / input.purchases) * 100) / 100 : 0;
  const ltvToCac = paidCac > 0 && customerLtv > 0 ? Math.round((customerLtv / paidCac) * 100) / 100 : 0;
  const totalClicks = input.organicClicks + input.searchClicks;
  const revenueInfluenced =
    totalClicks > 0 ? Math.round(input.revenue * (input.organicClicks / totalClicks) * 100) / 100 : 0;
  return { paidAdsEquivalent, paidCac, customerLtv, ltvToCac, revenueInfluenced };
}

export interface BlendedAdSpend {
  spend: number;
  clicks: number;
  conversions: number;
  /** Spend-weighted blended CPC across all available networks. */
  blendedCpc: number;
  networks: string[];
  available: boolean;
}

/**
 * Blend spend/clicks/conversions across the connected ad accounts and compute a
 * single spend-weighted CPC. Only networks that returned `available` data
 * contribute, so a failed network never drags the blended CPC toward a fake 0.
 */
export function blendAdSpend(results: AdSpendResult[]): BlendedAdSpend {
  const live = results.filter((r) => r.available);
  const spend = live.reduce((a, r) => a + r.spend, 0);
  const clicks = live.reduce((a, r) => a + r.clicks, 0);
  const conversions = live.reduce((a, r) => a + r.conversions, 0);
  return {
    spend: Math.round(spend * 100) / 100,
    clicks,
    conversions: Math.round(conversions * 100) / 100,
    blendedCpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
    networks: live.map((r) => r.network),
    available: live.length > 0,
  };
}
