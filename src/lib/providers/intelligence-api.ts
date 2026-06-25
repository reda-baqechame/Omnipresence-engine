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

export async function researchKeywordsLive(seed: string): Promise<{
  seed: string;
  suggestions: Array<{ keyword: string; volume_estimate?: number; source?: string }>;
  related: Array<{ keyword: string; volume_estimate?: number }>;
} | null> {
  const data = await intelligencePost<{ tasks: Array<{ result: Array<Record<string, unknown>> }> }>(
    "/keywords/suggestions/live",
    [{ keyword: seed }]
  );
  if (data) {
    const result = extractResult<{ seed: string; suggestions: unknown[]; related: unknown[] }>(data);
    if (result) {
      return result as {
        seed: string;
        suggestions: Array<{ keyword: string; volume_estimate?: number; source?: string }>;
        related: Array<{ keyword: string; volume_estimate?: number }>;
      };
    }
  }
  return getKeywordSuggestionsLive(seed);
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
    const { searchGoogleOrganic } = await import("@/lib/providers/dataforseo");
    const serp = await searchGoogleOrganic(keyword, "United States", "", []);
    if (!serp.success || !serp.data) return null;
    const top = serp.data.organicResults.slice(0, 10);
    const avgPos = top.length
      ? top.reduce((s, r) => s + (r.position || 10), 0) / top.length
      : 10;
    return {
      keyword,
      difficulty: Math.min(100, Math.round(avgPos * 8 + (serp.data.aiOverview?.present ? 15 : 0))),
      intent: "informational",
      top_domains: top.map((r) => {
        try {
          return new URL(r.url).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      }).filter(Boolean),
      serp_features: serp.data.aiOverview?.present ? ["ai_overview"] : [],
      has_ai_overview: Boolean(serp.data.aiOverview?.present),
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
