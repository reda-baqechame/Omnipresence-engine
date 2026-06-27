import type { ProviderResult, SERPResult } from "./types";
import { fetchWithTimeout, withRetry, isRetryableStatus } from "./http";
import { logProviderError } from "@/lib/observability/log";

const SERPER_URL = "https://google.serper.dev/search";

interface SerperOrganicItem {
  title?: string;
  link?: string;
  position?: number;
}

interface SerperAnswerBox {
  title?: string;
  answer?: string;
  link?: string;
  snippet?: string;
}

interface SerperSearchResponse {
  organic?: SerperOrganicItem[];
  answerBox?: SerperAnswerBox;
  knowledgeGraph?: { title?: string; description?: string; website?: string };
  /** Present on some Serper plans/responses for Google AI Overview */
  aiOverview?: {
    text?: string;
    sources?: Array<{ title?: string; link?: string; url?: string }>;
  };
}

function getSerperApiKey(): string {
  const key = process.env.SERPER_API_KEY;
  if (!key || key.startsWith("your-")) {
    throw new Error("Serper API key not configured");
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

function extractAiOverview(data: SerperSearchResponse): SERPResult["aiOverview"] | undefined {
  const sources: Array<{ url: string }> = [];

  if (data.aiOverview?.sources?.length) {
    for (const s of data.aiOverview.sources) {
      const url = s.link || s.url || "";
      if (url) sources.push({ url });
    }
    if (sources.length > 0) {
      const citedUrls = sources.map((s) => s.url);
      return {
        present: true,
        text: data.aiOverview.text,
        citedUrls,
        citedDomains: citedUrls.map(hostnameFromUrl).filter(Boolean),
      };
    }
  }

  if (data.answerBox?.answer || data.answerBox?.snippet) {
    const citedUrls = data.answerBox.link ? [data.answerBox.link] : [];
    return {
      present: true,
      text: data.answerBox.answer || data.answerBox.snippet,
      citedUrls,
      citedDomains: citedUrls.map(hostnameFromUrl).filter(Boolean),
    };
  }

  return undefined;
}

export async function searchGoogleOrganicSerper(
  keyword: string,
  location = "United States",
  brandDomain: string,
  competitors: string[]
): Promise<ProviderResult<SERPResult>> {
  try {
    const data = await withRetry(
      async () => {
        const response = await fetchWithTimeout(SERPER_URL, {
          method: "POST",
          headers: {
            "X-API-KEY": getSerperApiKey(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            q: keyword,
            location,
            gl: "us",
            hl: "en",
            num: 20,
          }),
          timeoutMs: 15000,
        });

        if (!response.ok) {
          const err = new Error(`Serper API error: ${response.status}`);
          (err as Error & { status?: number }).status = response.status;
          throw err;
        }

        return (await response.json()) as SerperSearchResponse;
      },
      { retries: 2, shouldRetry: (e) => isRetryableStatus((e as { status?: number })?.status ?? 0) }
    );

    const organicResults = (data.organic || []).map((item, index) => ({
      title: item.title || "",
      url: item.link || "",
      position: item.position ?? index + 1,
    }));

    const aiOverview = extractAiOverview(data);

    const domainLower = brandDomain.toLowerCase().replace(/^www\./, "");
    const brandToken = domainLower.split(".")[0];

    const brandInResults =
      organicResults.some((r) => r.url.toLowerCase().includes(domainLower)) ||
      (aiOverview?.citedDomains.some(
        (d) => d.includes(domainLower) || d.includes(brandToken)
      ) ?? false);

    const competitorInResults: Record<string, boolean> = {};
    for (const comp of competitors) {
      const compToken = comp.toLowerCase().replace(/\s+/g, "");
      competitorInResults[comp] =
        organicResults.some((r) => r.url.toLowerCase().includes(compToken)) ||
        (aiOverview?.citedDomains.some((d) => d.includes(compToken)) ?? false);
    }

    return {
      success: true,
      data: { organicResults, aiOverview, brandInResults, competitorInResults },
      creditsUsed: 1,
    };
  } catch (error) {
    logProviderError("serper", error, { keyword, location });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Serper request failed",
    };
  }
}
