import { createHmac } from "crypto";
import type { ProviderResult, SERPResult } from "./types";

const OMNIDATA_URL = process.env.OMNIDATA_BASE_URL?.replace(/\/$/, "");
const USE_OMNIDATA = Boolean(OMNIDATA_URL);

function getBaseUrl(): string {
  if (USE_OMNIDATA) return `${OMNIDATA_URL}/v3`;
  return "https://api.dataforseo.com/v3";
}

function getAuthHeaders(body: unknown): Record<string, string> {
  if (USE_OMNIDATA) {
    const key = process.env.OMNIDATA_API_KEY || "dev-local-key";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    const secret = process.env.OMNIDATA_SIGNING_SECRET;
    if (secret) {
      const timestamp = String(Date.now());
      const payload = JSON.stringify(body);
      const signature = createHmac("sha256", secret)
        .update(`${timestamp}.${payload}`)
        .digest("hex");
      headers["x-omnidata-timestamp"] = timestamp;
      headers["x-omnidata-signature"] = signature;
    }
    return headers;
  }

  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error("DataForSEO credentials not configured");
  }
  return {
    Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

export function isOmniDataActive(): boolean {
  return USE_OMNIDATA;
}

async function dataForSEORequest<T>(endpoint: string, body: unknown[]): Promise<T> {
  const response = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "POST",
    headers: getAuthHeaders(body),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${USE_OMNIDATA ? "OmniData" : "DataForSEO"} API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function searchGoogleOrganic(
  keyword: string,
  location = "United States",
  brandDomain: string,
  competitors: string[]
): Promise<ProviderResult<SERPResult>> {
  try {
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{
            type: string;
            rank_absolute?: number;
            title?: string;
            url?: string;
            description?: string;
            items?: Array<{ title?: string; url?: string }>;
          }>;
        }>;
      }>;
    }>("/serp/google/organic/live/advanced", [
      {
        keyword,
        location_name: location,
        language_code: "en",
        device: "desktop",
        os: "windows",
        depth: 20,
        load_async_ai_overview: true,
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    const organicResults = items
      .filter((i) => i.type === "organic")
      .map((i) => ({
        title: i.title || "",
        url: i.url || "",
        position: i.rank_absolute || 0,
      }));

    const aiOverviewItem = items.find((i) => i.type === "ai_overview");
    const aiOverview = aiOverviewItem
      ? {
          present: true,
          text: aiOverviewItem.description,
          citedUrls: (aiOverviewItem.items || []).map((s) => s.url || "").filter(Boolean),
          citedDomains: (aiOverviewItem.items || [])
            .map((s) => {
              try {
                return new URL(s.url || "").hostname.replace(/^www\./, "");
              } catch {
                return "";
              }
            })
            .filter(Boolean),
        }
      : undefined;

    const domainLower = brandDomain.toLowerCase().replace(/^www\./, "");
    const brandInResults = organicResults.some((r) =>
      r.url.toLowerCase().includes(domainLower)
    );

    const competitorInResults: Record<string, boolean> = {};
    for (const comp of competitors) {
      competitorInResults[comp] = organicResults.some((r) =>
        r.url.toLowerCase().includes(comp.toLowerCase().replace(/\s+/g, ""))
      );
    }

    return {
      success: true,
      data: { organicResults, aiOverview, brandInResults, competitorInResults },
      creditsUsed: USE_OMNIDATA ? 0 : 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "SERP request failed",
    };
  }
}

export async function searchGoogleAIMode(
  keyword: string,
  location = "United States"
): Promise<ProviderResult<{ text: string; citedUrls: string[]; citedDomains: string[] }>> {
  try {
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{
            type: string;
            text?: string;
            description?: string;
            items?: Array<{ url?: string }>;
          }>;
        }>;
      }>;
    }>("/serp/google/organic/live/advanced", [
      {
        keyword,
        location_name: location,
        language_code: "en",
        device: "desktop",
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    const aiItem = items.find((i) => i.type === "ai_overview" || i.type === "ai_mode");
    const citedUrls = (aiItem?.items || []).map((s) => s.url || "").filter(Boolean);
    const citedDomains = citedUrls
      .map((u) => {
        try {
          return new URL(u).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      })
      .filter(Boolean);

    return {
      success: true,
      data: {
        text: aiItem?.text || aiItem?.description || "",
        citedUrls,
        citedDomains,
      },
      creditsUsed: USE_OMNIDATA ? 0 : 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "AI Mode search failed",
    };
  }
}

export async function getBacklinks(
  domain: string,
  limit = 50
): Promise<ProviderResult<Array<{ url: string; domain: string; rank: number }>>> {
  try {
    if (USE_OMNIDATA) {
      const data = await dataForSEORequest<{
        tasks: Array<{
          result: Array<{
            items: Array<{
              source_url: string;
              source_domain: string;
              domain_rank?: number;
            }>;
          }>;
        }>;
      }>("/backlinks/summary/live", [{ target: domain, limit }]);

      const items = data.tasks?.[0]?.result?.[0]?.items || [];
      return {
        success: true,
        data: items.slice(0, limit).map((i) => ({
          url: i.source_url,
          domain: i.source_domain,
          rank: i.domain_rank ?? 0,
        })),
        creditsUsed: 0,
      };
    }

    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{
            url_from: string;
            domain_from: string;
            rank: number;
          }>;
        }>;
      }>;
    }>("/backlinks/backlinks/live", [
      {
        target: domain,
        limit,
        order_by: ["rank,desc"],
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    return {
      success: true,
      data: items.map((i) => ({
        url: i.url_from,
        domain: i.domain_from,
        rank: i.rank,
      })),
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Backlinks request failed",
    };
  }
}

export type LLMPlatform = "google" | "chat_gpt";

export interface LLMMentionSource {
  url?: string;
  domain?: string;
  title?: string;
}

export interface LLMMentionItem {
  question?: string;
  answer?: string;
  sources: LLMMentionSource[];
  aiSearchVolume?: number;
  platform: LLMPlatform;
}

export async function getLLMMentionsAggregated(
  domain: string,
  platform: LLMPlatform = "google",
  location = "United States"
): Promise<ProviderResult<{ mentions: number; citations: number; impressions: number }>> {
  if (USE_OMNIDATA) {
    return { success: false, error: "LLM Mentions not available on OmniData — use Perplexity/SERP stack" };
  }
  try {
    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{
            mentions?: number;
            ai_search_volume?: number;
            impressions?: number;
          }>;
        }>;
      }>;
    }>("/ai_optimization/llm_mentions/aggregated_metrics/live", [
      {
        target: [{ domain: cleanDomain, search_scope: ["sources"] }],
        platform,
        location_name: platform === "chat_gpt" ? "United States" : location,
        language_code: "en",
      },
    ]);

    const item = data.tasks?.[0]?.result?.[0]?.items?.[0];
    return {
      success: true,
      data: {
        mentions: item?.mentions ?? 0,
        citations: item?.mentions ?? 0,
        impressions: item?.impressions ?? item?.ai_search_volume ?? 0,
      },
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "LLM Mentions aggregated failed",
    };
  }
}

export async function searchLLMMentions(
  keyword: string,
  platform: LLMPlatform = "google",
  location = "United States"
): Promise<ProviderResult<LLMMentionItem[]>> {
  if (USE_OMNIDATA) {
    return { success: false, error: "LLM Mentions not available on OmniData" };
  }
  try {
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{
            question?: string;
            answer?: string;
            sources?: Array<{ url?: string; domain?: string; title?: string }>;
            ai_search_volume?: number;
            platform?: string;
          }>;
        }>;
      }>;
    }>("/ai_optimization/llm_mentions/search/live", [
      {
        keyword,
        platform,
        location_name: platform === "chat_gpt" ? "United States" : location,
        language_code: "en",
        limit: 10,
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    return {
      success: true,
      data: items.map((i) => ({
        question: i.question,
        answer: i.answer,
        sources: (i.sources || []).map((s) => ({
          url: s.url,
          domain: s.domain,
          title: s.title,
        })),
        aiSearchVolume: i.ai_search_volume,
        platform,
      })),
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "LLM Mentions search failed",
    };
  }
}

export async function crossAggregatedLLMMetrics(
  domains: string[],
  platform: LLMPlatform = "google"
): Promise<ProviderResult<Record<string, { mentions: number; citations: number }>>> {
  if (USE_OMNIDATA) {
    return { success: false, error: "LLM Mentions not available on OmniData" };
  }
  try {
    const targets = domains.map((d) => ({
      domain: d.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0],
      search_scope: ["sources"],
    }));

    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{
            target?: string;
            mentions?: number;
          }>;
        }>;
      }>;
    }>("/ai_optimization/llm_mentions/cross_aggregated_metrics/live", [
      {
        targets,
        platform,
        location_name: "United States",
        language_code: "en",
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    const out: Record<string, { mentions: number; citations: number }> = {};
    for (const item of items) {
      const key = item.target || "unknown";
      out[key] = { mentions: item.mentions ?? 0, citations: item.mentions ?? 0 };
    }
    return { success: true, data: out, creditsUsed: 1 };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Cross aggregated LLM metrics failed",
    };
  }
}

export async function getLLMTopDomains(
  keyword: string,
  platform: LLMPlatform = "google"
): Promise<ProviderResult<Array<{ domain: string; mentions: number }>>> {
  if (USE_OMNIDATA) {
    return { success: false, error: "LLM Mentions not available on OmniData" };
  }
  try {
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{ domain?: string; mentions?: number }>;
        }>;
      }>;
    }>("/ai_optimization/llm_mentions/top_domains/live", [
      {
        keyword,
        platform,
        location_name: "United States",
        language_code: "en",
        limit: 20,
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    return {
      success: true,
      data: items.map((i) => ({ domain: i.domain || "", mentions: i.mentions ?? 0 })),
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "LLM top domains failed",
    };
  }
}

export async function resolveCompetitorDomain(
  competitorName: string,
  industry?: string
): Promise<string | null> {
  const query = `${competitorName} ${industry || ""} official site`.trim();
  const res = await searchGoogleOrganic(query, "United States", "", []);
  if (!res.success || !res.data?.organicResults?.length) return null;
  const top = res.data.organicResults[0];
  try {
    return new URL(top.url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function checkRankPosition(
  keyword: string,
  domain: string,
  location = "United States"
): Promise<
  ProviderResult<{
    position: number | null;
    url?: string;
    serp_features: string[];
    striking_distance: boolean;
  }>
> {
  try {
    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          snapshot?: {
            position: number | null;
            url?: string;
            serp_features?: string[];
          };
          striking_distance?: boolean;
        }>;
      }>;
    }>("/rank_tracker/check/live", [
      { keyword, domain: cleanDomain, location_name: location },
    ]);

    const result = data.tasks?.[0]?.result?.[0];
    const snapshot = result?.snapshot;
    return {
      success: true,
      data: {
        position: snapshot?.position ?? null,
        url: snapshot?.url,
        serp_features: snapshot?.serp_features || [],
        striking_distance: result?.striking_distance ?? false,
      },
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Rank check failed",
    };
  }
}
