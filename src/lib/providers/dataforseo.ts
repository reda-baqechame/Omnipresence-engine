import type { ProviderResult, SERPResult } from "./types";

const BASE_URL = "https://api.dataforseo.com/v3";

function getAuthHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error("DataForSEO credentials not configured");
  }
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

async function dataForSEORequest<T>(endpoint: string, body: unknown[]): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`DataForSEO API error: ${response.status}`);
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
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "DataForSEO request failed",
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
            items?: Array<{ url?: string }>;
          }>;
        }>;
      }>;
    }>("/serp/google/ai_mode/live/advanced", [
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
        text: aiItem?.text || "",
        citedUrls,
        citedDomains,
      },
      creditsUsed: 1,
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
