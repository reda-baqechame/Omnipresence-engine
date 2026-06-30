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

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v18";

// Geo/language constants: 2840 = United States, 1000 = English.
const DEFAULT_GEO = process.env.GOOGLE_ADS_GEO || "geoTargetConstants/2840";
const DEFAULT_LANG = process.env.GOOGLE_ADS_LANGUAGE || "languageConstants/1000";

/**
 * Per-tenant Google Ads credentials. When a customer connects their own Google
 * Ads account, the main app passes these per request so the tenant's own quota
 * and account are used (true per-tenant OAuth). Absent fields fall back to the
 * process-wide env (single-account/shared-MCC mode).
 */
export interface GoogleAdsCreds {
  developerToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  customerId?: string;
  loginCustomerId?: string;
}

interface ResolvedCreds {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string;
  loginCustomerId?: string;
}

function resolveCreds(creds?: GoogleAdsCreds): ResolvedCreds | null {
  const developerToken = creds?.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = creds?.clientId || process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = creds?.clientSecret || process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = creds?.refreshToken || process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const customerId = creds?.customerId || process.env.GOOGLE_ADS_CUSTOMER_ID;
  const loginCustomerId = creds?.loginCustomerId || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (!developerToken || !clientId || !clientSecret || !refreshToken || !customerId) {
    return null;
  }
  return { developerToken, clientId, clientSecret, refreshToken, customerId, loginCustomerId };
}

export function hasKeywordPlanner(creds?: GoogleAdsCreds): boolean {
  return resolveCreds(creds) !== null;
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

export interface KeywordMetricsOptions {
  /** Per-tenant Google Ads credentials (overrides env when present). */
  creds?: GoogleAdsCreds;
  /** geoTargetConstants/<id> or a bare numeric id; defaults to US. */
  geo?: string;
  /** languageConstants/<id> or a bare numeric id; defaults to English. */
  language?: string;
}

// Per-tenant token cache keyed by refresh token (so accounts don't share a token).
const tokenCache = new Map<string, { value: string; expiresAt: number }>();

async function getAccessToken(creds: ResolvedCreds): Promise<string | null> {
  const cached = tokenCache.get(creds.refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
  try {
    const body = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
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
    tokenCache.set(creds.refreshToken, {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    });
    return data.access_token;
  } catch {
    return null;
  }
}

/** Normalize a geo/language id to the full resource path the API expects. */
function geoConstant(geo?: string): string {
  if (!geo) return DEFAULT_GEO;
  return /^\d+$/.test(geo) ? `geoTargetConstants/${geo}` : geo;
}
function langConstant(language?: string): string {
  if (!language) return DEFAULT_LANG;
  return /^\d+$/.test(language) ? `languageConstants/${language}` : language;
}

function microsToCpc(micros?: string | number): number | undefined {
  if (micros === undefined || micros === null) return undefined;
  const n = typeof micros === "string" ? Number(micros) : micros;
  if (!Number.isFinite(n)) return undefined;
  return Math.round((n / 1_000_000) * 100) / 100;
}

/** Real metrics for up to ~10k keywords (API caps the batch; we chunk to 1000). */
export async function getKeywordMetrics(
  keywords: string[],
  options?: KeywordMetricsOptions
): Promise<KeywordMetric[] | null> {
  const creds = resolveCreds(options?.creds);
  if (!creds) return null;
  const token = await getAccessToken(creds);
  if (!token) return null;

  const clean = Array.from(
    new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))
  );
  if (clean.length === 0) return [];

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": creds.developerToken,
    "Content-Type": "application/json",
  };
  if (creds.loginCustomerId) headers["login-customer-id"] = creds.loginCustomerId;

  const geo = geoConstant(options?.geo);
  const lang = langConstant(options?.language);
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${creds.customerId}:generateKeywordHistoricalMetrics`;

  const out: KeywordMetric[] = [];
  for (let i = 0; i < clean.length; i += 1000) {
    const batch = clean.slice(i, i + 1000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          keywords: batch,
          geoTargetConstants: [geo],
          language: lang,
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
export async function getAverageCpc(
  keywords: string[],
  options?: KeywordMetricsOptions
): Promise<number | null> {
  const metrics = await getKeywordMetrics(keywords, options);
  if (!metrics || metrics.length === 0) return null;
  const cpcs = metrics.map((m) => m.cpc).filter((c): c is number => typeof c === "number" && c > 0);
  if (cpcs.length === 0) return null;
  return Math.round((cpcs.reduce((a, b) => a + b, 0) / cpcs.length) * 100) / 100;
}
