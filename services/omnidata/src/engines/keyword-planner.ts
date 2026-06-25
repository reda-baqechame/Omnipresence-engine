/**
 * Google Ads Keyword Planner API -> REAL monthly search volume + CPC + competition.
 *
 * Requires (all free to obtain; OAuth-gated):
 *   GOOGLE_ADS_DEVELOPER_TOKEN
 *   GOOGLE_ADS_CLIENT_ID
 *   GOOGLE_ADS_CLIENT_SECRET
 *   GOOGLE_ADS_REFRESH_TOKEN
 *   GOOGLE_ADS_CUSTOMER_ID            (10 digits, no dashes)
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID      (optional MCC id)
 *
 * When credentials are absent, callers keep the autocomplete heuristic but must
 * stamp data_source: "estimated".
 */

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID;
const LOGIN_CUSTOMER_ID = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v18";

// Geo/language constants: 2840 = United States, 1000 = English.
const GEO = process.env.GOOGLE_ADS_GEO || "geoTargetConstants/2840";
const LANG = process.env.GOOGLE_ADS_LANGUAGE || "languageConstants/1000";

export function hasKeywordPlanner(): boolean {
  return Boolean(
    DEV_TOKEN && CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN && CUSTOMER_ID
  );
}

export interface KeywordMetric {
  keyword: string;
  avg_monthly_searches: number;
  competition: "LOW" | "MEDIUM" | "HIGH" | "UNSPECIFIED";
  competition_index?: number;
  low_cpc?: number;
  high_cpc?: number;
  cpc?: number;
}

let accessToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (accessToken && accessToken.expiresAt > Date.now() + 60_000) {
    return accessToken.value;
  }
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) return null;
  try {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: "refresh_token",
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    accessToken = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return accessToken.value;
  } catch {
    return null;
  }
}

function microsToCpc(micros?: string | number): number | undefined {
  if (micros === undefined || micros === null) return undefined;
  const n = typeof micros === "string" ? Number(micros) : micros;
  if (!Number.isFinite(n)) return undefined;
  return Math.round((n / 1_000_000) * 100) / 100;
}

/** Real metrics for up to ~10k keywords (API caps the batch; we chunk to 1000). */
export async function getKeywordMetrics(keywords: string[]): Promise<KeywordMetric[] | null> {
  if (!hasKeywordPlanner()) return null;
  const token = await getAccessToken();
  if (!token) return null;

  const clean = Array.from(
    new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))
  );
  if (clean.length === 0) return [];

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": DEV_TOKEN!,
    "Content-Type": "application/json",
  };
  if (LOGIN_CUSTOMER_ID) headers["login-customer-id"] = LOGIN_CUSTOMER_ID;

  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER_ID}:generateKeywordHistoricalMetrics`;

  const out: KeywordMetric[] = [];
  for (let i = 0; i < clean.length; i += 1000) {
    const batch = clean.slice(i, i + 1000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          keywords: batch,
          geoTargetConstants: [GEO],
          language: LANG,
          keywordPlanNetwork: "GOOGLE_SEARCH",
        }),
      });
      if (!res.ok) return out.length ? out : null;
      const data = (await res.json()) as {
        results?: Array<{
          text?: string;
          keywordMetrics?: {
            avgMonthlySearches?: string | number;
            competition?: KeywordMetric["competition"];
            competitionIndex?: string | number;
            lowTopOfPageBidMicros?: string | number;
            highTopOfPageBidMicros?: string | number;
          };
        }>;
      };
      for (const r of data.results || []) {
        const m = r.keywordMetrics || {};
        const low = microsToCpc(m.lowTopOfPageBidMicros);
        const high = microsToCpc(m.highTopOfPageBidMicros);
        out.push({
          keyword: r.text || "",
          avg_monthly_searches: Number(m.avgMonthlySearches ?? 0),
          competition: m.competition || "UNSPECIFIED",
          competition_index:
            m.competitionIndex !== undefined ? Number(m.competitionIndex) : undefined,
          low_cpc: low,
          high_cpc: high,
          cpc: high ?? low,
        });
      }
    } catch {
      return out.length ? out : null;
    }
  }
  return out;
}

/** Average real CPC across keywords (used by the paid-ads-equivalent calculator). */
export async function getAverageCpc(keywords: string[]): Promise<number | null> {
  const metrics = await getKeywordMetrics(keywords);
  if (!metrics || metrics.length === 0) return null;
  const cpcs = metrics.map((m) => m.cpc).filter((c): c is number => typeof c === "number" && c > 0);
  if (cpcs.length === 0) return null;
  return Math.round((cpcs.reduce((a, b) => a + b, 0) / cpcs.length) * 100) / 100;
}
