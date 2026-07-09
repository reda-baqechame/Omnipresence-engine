import { labsApiPost, hasLabsApi, getKeywordSuggestionsLive } from "@/lib/providers/dataforseo";

const USE_OMNIDATA = Boolean(process.env.OMNIDATA_BASE_URL?.replace(/\/$/, ""));

async function intelligencePost<T>(path: string, body: unknown[]): Promise<T | null> {
  if (!USE_OMNIDATA) return null;
  return labsApiPost<T>(path, body);
}

function extractResult<T>(data: {
  tasks?: Array<{ result?: Array<Record<string, unknown>> }>;
}): T | null {
  const block = data.tasks?.[0]?.result?.[0];
  return (block as T) || null;
}

export interface LiveKeywordRow {
  keyword: string;
  volume_estimate?: number;
  source?: string;
  /** Relative Google Trends demand index (0-100), not absolute volume. */
  trend_index?: number;
  data_source?: "keyword_planner" | "trends_estimated" | "estimated";
}

/** Per-tenant Google Ads credentials forwarded to the Keyword Planner. */
export interface GoogleAdsCredsInput {
  developerToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  customerId?: string;
  loginCustomerId?: string;
}

export interface KeywordResearchOptions {
  /** geoTargetConstants/<id> or a bare numeric id (e.g. "2826" for the UK). */
  geo?: string;
  /** languageConstants/<id> or a bare numeric id. */
  language?: string;
  /** Per-tenant Google Ads OAuth so the tenant's own account/quota is used. */
  credentials?: GoogleAdsCredsInput;
}

export async function researchKeywordsLive(
  seed: string,
  options?: KeywordResearchOptions
): Promise<{
  seed: string;
  suggestions: LiveKeywordRow[];
  related: LiveKeywordRow[];
  data_source?: "keyword_planner" | "trends_estimated" | "estimated";
} | null> {
  const data = await intelligencePost<{ tasks: Array<{ result: Array<Record<string, unknown>> }> }>(
    "/keywords/suggestions/live",
    [{
      keyword: seed,
      geo: options?.geo,
      language: options?.language,
      credentials: options?.credentials,
    }]
  );
  if (data) {
    const result = extractResult<{
      seed: string;
      suggestions: unknown[];
      related: unknown[];
      data_source?: "keyword_planner" | "trends_estimated" | "estimated";
    }>(data);
    if (result) {
      return result as {
        seed: string;
        suggestions: LiveKeywordRow[];
        related: LiveKeywordRow[];
        data_source?: "keyword_planner" | "trends_estimated" | "estimated";
      };
    }
  }
  return getKeywordSuggestionsLive(seed);
}

/** Lightweight keyword-intent heuristic (used only for estimated fallbacks). */
function inferIntent(keyword: string): "transactional" | "commercial" | "informational" | "navigational" {
  const k = keyword.toLowerCase();
  if (/\b(buy|price|pricing|cost|cheap|deal|discount|coupon|order|shop|for sale)\b/.test(k)) return "transactional";
  if (/\b(best|top|review|reviews|vs|versus|compare|comparison|alternative)\b/.test(k)) return "commercial";
  if (/\b(login|sign in|download|official|website|app)\b/.test(k)) return "navigational";
  return "informational";
}

export async function keywordDifficultyLive(keyword: string) {
  const data = await intelligencePost<{ tasks: Array<{ result: Array<Record<string, unknown>> }> }>(
    "/keywords/difficulty/live",
    [{ keyword }]
  );
  if (data) {
    const result = extractResult<{
      keyword: string;
      difficulty: number;
      intent: string;
      top_domains: string[];
      serp_features: string[];
      has_ai_overview: boolean;
    }>(data);
    if (result) return result;
  }

  if (!USE_OMNIDATA && hasLabsApi()) {
    // Route through sovereign-first SERP router — never import searchGoogleOrganic
    // directly (Patch J bypass). Paid DataForSEO only runs if rankedAdapters selects it.
    const { searchGoogleOrganicRouter } = await import("@/lib/providers/serp-router");
    const serp = await searchGoogleOrganicRouter(keyword, "United States", "", []);
    if (!serp.success || !serp.data) return null;
    const top = serp.data.organicResults.slice(0, 10);
    const avgPos = top.length
      ? top.reduce((s, r) => s + (r.position || 10), 0) / top.length
      : 10;
    return {
      keyword,
      difficulty: Math.min(100, Math.round(avgPos * 8 + (serp.data.aiOverview?.present ? 15 : 0))),
      intent: inferIntent(keyword),
      top_domains: top.map((r) => {
        try {
          return new URL(r.url).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      }).filter(Boolean),
      serp_features: serp.data.aiOverview?.present ? ["ai_overview"] : [],
      has_ai_overview: Boolean(serp.data.aiOverview?.present),
      // Synthesized from SERP authority, not a measured KD — label honestly.
      data_source: "estimated" as const,
      is_estimated: true,
    };
  }

  return null;
}

export async function contentGapsLive(domain: string, competitors: string[], seeds: string[]) {
  const data = await intelligencePost<{ tasks: Array<{ result: Array<{ gaps: unknown[] }> }> }>(
    "/labs/content_gaps/live",
    [{ domain, competitors, seeds }]
  );
  if (!data) return null;
  const result = extractResult<{ gaps: unknown[]; total: number }>(data);
  return result?.gaps || null;
}

export async function backlinkGapsLive(domain: string, competitors: string[]) {
  const data = await intelligencePost<{ tasks: Array<{ result: Array<{ gaps: unknown[] }> }> }>(
    "/backlinks/gap/live",
    [{ domain, competitors }]
  );
  if (!data) return null;
  const result = extractResult<{ gaps: unknown[] }>(data);
  return result?.gaps || null;
}

export async function keywordOpportunitiesLive(domain: string, keywords: string[]) {
  const data = await intelligencePost<{ tasks: Array<{ result: Array<{ opportunities: unknown[] }> }> }>(
    "/labs/keyword_opportunities/live",
    [{ domain, keywords }]
  );
  if (!data) return null;
  const result = extractResult<{ opportunities: unknown[] }>(data);
  return result?.opportunities || null;
}

export function hasIntelligenceApi(): boolean {
  return (
    hasLabsApi() ||
    Boolean(process.env.SERPER_API_KEY) ||
    Boolean(process.env.BRAVE_SEARCH_API_KEY)
  );
}
