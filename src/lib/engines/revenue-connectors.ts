/**
 * First-party revenue / booking / CRM connectors (Wave S1).
 *
 * Each function reads per-project credentials (from oauth_connections) and calls
 * the real upstream API, returning measured business outcomes. Every connector
 * returns an explicit `available` flag so a failed sync surfaces as Unavailable
 * rather than a refund-triggering confident zero. No modeled data here — these
 * are the ground-truth money/lead sources that back the outcome guarantee.
 */
// Self-contained (no `@/` alias imports) so the parsing/summing logic is
// directly runnable under `node --test` like the other engine unit tests.
function fetchWithTimeout(
  input: string | URL,
  init: (RequestInit & { timeoutMs?: number }) = {}
): Promise<Response> {
  const { timeoutMs = 15000, signal, ...rest } = init;
  return fetch(input, { ...rest, signal: signal ?? AbortSignal.timeout(timeoutMs) });
}

function logProviderError(scope: string, error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(JSON.stringify({ level: "warn", scope, message, ...context }));
}

export interface StripeRevenueResult {
  purchases: number;
  revenue: number;
  currency: string;
  available: boolean;
}

/**
 * Real Stripe revenue from charges in the window. Uses a per-project restricted
 * secret key (rk_…/sk_…) stored as the Stripe connection's access_token. Sums
 * captured, non-refunded charges. Pages up to 1000 charges to bound cost.
 */
export async function syncStripeRevenue(
  apiKey: string,
  sinceUnixSeconds: number
): Promise<StripeRevenueResult> {
  if (!apiKey) return { purchases: 0, revenue: 0, currency: "usd", available: false };
  try {
    let purchases = 0;
    let revenueMinor = 0;
    let currency = "usd";
    let startingAfter: string | undefined;
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({
        limit: "100",
        "created[gte]": String(sinceUnixSeconds),
      });
      if (startingAfter) params.set("starting_after", startingAfter);
      const res = await fetchWithTimeout(`https://api.stripe.com/v1/charges?${params.toString()}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: 15000,
      });
      if (!res.ok) throw new Error(`Stripe charges ${res.status}`);
      const json = (await res.json()) as {
        data: Array<{ id: string; amount: number; currency: string; paid: boolean; refunded: boolean; amount_refunded: number; status: string }>;
        has_more: boolean;
      };
      for (const charge of json.data) {
        if (charge.status !== "succeeded" || !charge.paid) continue;
        const net = charge.amount - (charge.amount_refunded || 0);
        if (net <= 0) continue;
        purchases += 1;
        revenueMinor += net;
        currency = charge.currency || currency;
      }
      if (!json.has_more || json.data.length === 0) break;
      startingAfter = json.data[json.data.length - 1]?.id;
      if (!startingAfter) break;
    }
    return {
      purchases,
      revenue: Math.round((revenueMinor / 100) * 100) / 100,
      currency,
      available: true,
    };
  } catch (error) {
    logProviderError("revenue.stripe", error, {});
    return { purchases: 0, revenue: 0, currency: "usd", available: false };
  }
}

export interface ShopifyRevenueResult {
  purchases: number;
  revenue: number;
  available: boolean;
}

/**
 * Real Shopify order revenue in the window via the Admin REST API. `shop` is the
 * myshopify domain (e.g. acme.myshopify.com); `token` is the Admin API access
 * token. Counts paid/partially_paid orders.
 */
export async function syncShopifyRevenue(
  shop: string,
  token: string,
  sinceIso: string
): Promise<ShopifyRevenueResult> {
  if (!shop || !token) return { purchases: 0, revenue: 0, available: false };
  const cleanShop = shop.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  try {
    const params = new URLSearchParams({
      status: "any",
      created_at_min: sinceIso,
      limit: "250",
      fields: "total_price,financial_status,currency",
    });
    let purchases = 0;
    let revenue = 0;
    let url: string | null = `https://${cleanShop}/admin/api/2024-10/orders.json?${params.toString()}`;
    for (let page = 0; page < 10 && url; page++) {
      const res: Response = await fetchWithTimeout(url, {
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        timeoutMs: 15000,
      });
      if (!res.ok) throw new Error(`Shopify orders ${res.status}`);
      const json = (await res.json()) as {
        orders: Array<{ total_price: string; financial_status: string }>;
      };
      for (const order of json.orders || []) {
        if (order.financial_status === "paid" || order.financial_status === "partially_paid") {
          purchases += 1;
          revenue += parseFloat(order.total_price || "0") || 0;
        }
      }
      // Cursor pagination via the Link header.
      const link = res.headers.get("link") || res.headers.get("Link") || "";
      const next = /<([^>]+)>;\s*rel="next"/.exec(link);
      url = next ? next[1] : null;
    }
    return { purchases, revenue: Math.round(revenue * 100) / 100, available: true };
  } catch (error) {
    logProviderError("revenue.shopify", error, { shop: cleanShop });
    return { purchases: 0, revenue: 0, available: false };
  }
}

export interface CalendlyBookingResult {
  bookings: number;
  available: boolean;
}

/**
 * Real Calendly bookings in the window. `token` is a Calendly personal/OAuth
 * access token. Resolves the current user's organization, then counts active
 * scheduled events that start within the window.
 */
export async function syncCalendlyBookings(
  token: string,
  sinceIso: string,
  untilIso: string
): Promise<CalendlyBookingResult> {
  if (!token) return { bookings: 0, available: false };
  try {
    const meRes = await fetchWithTimeout("https://api.calendly.com/users/me", {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 12000,
    });
    if (!meRes.ok) throw new Error(`Calendly users/me ${meRes.status}`);
    const me = (await meRes.json()) as { resource: { current_organization: string } };
    const org = me.resource?.current_organization;
    if (!org) throw new Error("Calendly: no organization");

    let bookings = 0;
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({
        organization: org,
        status: "active",
        count: "100",
        min_start_time: sinceIso,
        max_start_time: untilIso,
      });
      if (pageToken) params.set("page_token", pageToken);
      const res = await fetchWithTimeout(`https://api.calendly.com/scheduled_events?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeoutMs: 12000,
      });
      if (!res.ok) throw new Error(`Calendly events ${res.status}`);
      const json = (await res.json()) as {
        collection: Array<{ uri: string }>;
        pagination: { next_page_token: string | null };
      };
      bookings += (json.collection || []).length;
      pageToken = json.pagination?.next_page_token || undefined;
      if (!pageToken) break;
    }
    return { bookings, available: true };
  } catch (error) {
    logProviderError("revenue.calendly", error, {});
    return { bookings: 0, available: false };
  }
}

export interface HubspotCrmResult {
  leads: number;
  dealsCount: number;
  pipelineValue: number;
  wonValue: number;
  available: boolean;
}

/**
 * Real HubSpot CRM leads + pipeline in the window. `token` is a HubSpot OAuth
 * access token (or private-app token). Counts contacts created in the window
 * (leads) and sums deal amounts by stage (open pipeline vs. closed-won).
 */
export async function syncHubspotCrm(
  token: string,
  sinceMs: number
): Promise<HubspotCrmResult> {
  if (!token) return { leads: 0, dealsCount: 0, pipelineValue: 0, wonValue: 0, available: false };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  try {
    // Leads = contacts created in the window.
    const contactsRes = await fetchWithTimeout("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST",
      headers,
      timeoutMs: 15000,
      body: JSON.stringify({
        filterGroups: [
          { filters: [{ propertyName: "createdate", operator: "GTE", value: String(sinceMs) }] },
        ],
        limit: 1,
      }),
    });
    if (!contactsRes.ok) throw new Error(`HubSpot contacts ${contactsRes.status}`);
    const contacts = (await contactsRes.json()) as { total: number };
    const leads = contacts.total || 0;

    // Deals created in the window — page to sum amounts.
    let dealsCount = 0;
    let pipelineValue = 0;
    let wonValue = 0;
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const dealsRes: Response = await fetchWithTimeout("https://api.hubapi.com/crm/v3/objects/deals/search", {
        method: "POST",
        headers,
        timeoutMs: 15000,
        body: JSON.stringify({
          filterGroups: [
            { filters: [{ propertyName: "createdate", operator: "GTE", value: String(sinceMs) }] },
          ],
          properties: ["amount", "dealstage", "hs_is_closed_won"],
          limit: 100,
          after,
        }),
      });
      if (!dealsRes.ok) throw new Error(`HubSpot deals ${dealsRes.status}`);
      const deals = (await dealsRes.json()) as {
        results: Array<{ properties: { amount?: string; hs_is_closed_won?: string } }>;
        paging?: { next?: { after?: string } };
      };
      for (const deal of deals.results || []) {
        const amount = parseFloat(deal.properties?.amount || "0") || 0;
        dealsCount += 1;
        if (deal.properties?.hs_is_closed_won === "true") wonValue += amount;
        else pipelineValue += amount;
      }
      after = deals.paging?.next?.after;
      if (!after) break;
    }

    return {
      leads,
      dealsCount,
      pipelineValue: Math.round(pipelineValue * 100) / 100,
      wonValue: Math.round(wonValue * 100) / 100,
      available: true,
    };
  } catch (error) {
    logProviderError("revenue.hubspot", error, {});
    return { leads: 0, dealsCount: 0, pipelineValue: 0, wonValue: 0, available: false };
  }
}

export interface GbpPerformanceResult {
  calls: number;
  websiteClicks: number;
  directionRequests: number;
  searchViews: number;
  available: boolean;
}

const GBP_DAILY_METRICS = [
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
] as const;

function sumTimeSeries(ts: { datedValues?: Array<{ value?: string }> } | undefined): number {
  if (!ts?.datedValues) return 0;
  return ts.datedValues.reduce((acc, dv) => acc + (parseInt(dv.value || "0", 10) || 0), 0);
}

/**
 * Real Google Business Profile performance metrics for a location in the window
 * via the Business Profile Performance API. `accessToken` is a Google token with
 * the business.manage scope; `locationId` is the numeric location id.
 */
export async function syncGbpPerformance(
  accessToken: string,
  locationId: string,
  start: { year: number; month: number; day: number },
  end: { year: number; month: number; day: number }
): Promise<GbpPerformanceResult> {
  if (!accessToken || !locationId) {
    return { calls: 0, websiteClicks: 0, directionRequests: 0, searchViews: 0, available: false };
  }
  try {
    const params = new URLSearchParams();
    for (const m of GBP_DAILY_METRICS) params.append("dailyMetrics", m);
    params.set("dailyRange.start_date.year", String(start.year));
    params.set("dailyRange.start_date.month", String(start.month));
    params.set("dailyRange.start_date.day", String(start.day));
    params.set("dailyRange.end_date.year", String(end.year));
    params.set("dailyRange.end_date.month", String(end.month));
    params.set("dailyRange.end_date.day", String(end.day));

    const res = await fetchWithTimeout(
      `https://businessprofileperformance.googleapis.com/v1/locations/${locationId}:fetchMultiDailyMetricsTimeSeries?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeoutMs: 15000 }
    );
    if (!res.ok) throw new Error(`GBP performance ${res.status}`);
    const json = (await res.json()) as {
      multiDailyMetricTimeSeries?: Array<{
        dailyMetricTimeSeries?: Array<{
          dailyMetric?: string;
          timeSeries?: { datedValues?: Array<{ value?: string }> };
        }>;
      }>;
    };

    const totals: Record<string, number> = {};
    for (const multi of json.multiDailyMetricTimeSeries || []) {
      for (const series of multi.dailyMetricTimeSeries || []) {
        if (!series.dailyMetric) continue;
        totals[series.dailyMetric] = (totals[series.dailyMetric] || 0) + sumTimeSeries(series.timeSeries);
      }
    }

    return {
      calls: totals.CALL_CLICKS || 0,
      websiteClicks: totals.WEBSITE_CLICKS || 0,
      directionRequests: totals.BUSINESS_DIRECTION_REQUESTS || 0,
      searchViews:
        (totals.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH || 0) +
        (totals.BUSINESS_IMPRESSIONS_MOBILE_SEARCH || 0),
      available: true,
    };
  } catch (error) {
    logProviderError("revenue.gbp_performance", error, { locationId });
    return { calls: 0, websiteClicks: 0, directionRequests: 0, searchViews: 0, available: false };
  }
}
