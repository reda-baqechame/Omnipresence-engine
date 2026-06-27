import type { ProviderResult, SERPResult } from "./types";
import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";

const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
}

function getBraveApiKey(): string {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key || key.startsWith("your-")) {
    throw new Error("Brave Search API key not configured");
  }
  return key;
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function searchGoogleOrganicBrave(
  keyword: string,
  _location = "United States",
  brandDomain: string,
  competitors: string[]
): Promise<ProviderResult<SERPResult>> {
  try {
    const params = new URLSearchParams({
      q: keyword,
      count: "20",
      search_lang: "en",
      country: "US",
      text_decorations: "false",
    });

    const response = await fetchWithTimeout(`${BRAVE_URL}?${params}`, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": getBraveApiKey(),
      },
      timeoutMs: 15000,
    });

    if (!response.ok) {
      throw new Error(`Brave Search API error: ${response.status}`);
    }

    const data = (await response.json()) as BraveSearchResponse;
    const organicResults = (data.web?.results || []).map((item, index) => ({
      title: item.title || "",
      url: item.url || "",
      position: index + 1,
    }));

    const domainLower = brandDomain.toLowerCase().replace(/^www\./, "");
    const brandToken = domainLower.split(".")[0];

    const brandInResults = organicResults.some((r) =>
      r.url.toLowerCase().includes(domainLower)
    );

    const competitorInResults: Record<string, boolean> = {};
    for (const comp of competitors) {
      const compToken = comp.toLowerCase().replace(/\s+/g, "");
      competitorInResults[comp] = organicResults.some((r) =>
        r.url.toLowerCase().includes(compToken)
      );
    }

    return {
      success: true,
      data: { organicResults, brandInResults, competitorInResults },
      creditsUsed: 1,
    };
  } catch (error) {
    logProviderError("brave-search", error, { keyword });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Brave Search request failed",
    };
  }
}

export function extractDomainFromUrl(url: string): string {
  return hostnameFromUrl(url);
}
