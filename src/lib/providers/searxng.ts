import type { ProviderResult, SERPResult } from "./types";
import { fetchWithTimeout, withRetry, isRetryableStatus } from "./http";
import { logProviderError } from "@/lib/observability/log";

/**
 * SearXNG — self-hosted, keyless meta-search aggregator (Phase 8).
 * Wired as a free SERP source: when `SEARXNG_URL` is set (a Railway service or
 * any reachable instance with JSON output enabled), rankings work with zero
 * paid SERP keys. Degrades to `available:false` when not configured.
 */

const DEFAULT_TIMEOUT = 15_000;

export function hasSearxngCapability(): boolean {
  const u = process.env.SEARXNG_URL;
  return Boolean(u && u.trim() && !u.startsWith("your-"));
}

function getSearxngUrl(): string {
  return (process.env.SEARXNG_URL || "").replace(/\/+$/, "");
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

interface SearxngResult {
  url?: string;
  title?: string;
  content?: string;
  engine?: string;
  positions?: number[];
}
interface SearxngResponse {
  results?: SearxngResult[];
}

export async function searchGoogleOrganicSearxng(
  keyword: string,
  _location = "United States",
  brandDomain: string,
  competitors: string[]
): Promise<ProviderResult<SERPResult>> {
  if (!hasSearxngCapability()) {
    return { success: false, error: "SEARXNG_URL not configured" };
  }
  const base = getSearxngUrl();
  const params = new URLSearchParams({
    q: keyword,
    format: "json",
    language: "en-US",
    safesearch: "0",
    categories: "general",
  });

  try {
    const data = await withRetry(
      async () => {
        const res = await fetchWithTimeout(`${base}/search?${params}`, {
          headers: { Accept: "application/json" },
          timeoutMs: DEFAULT_TIMEOUT,
        });
        if (!res.ok) {
          const err = new Error(`SearXNG error: ${res.status}`);
          (err as Error & { status?: number }).status = res.status;
          throw err;
        }
        return (await res.json()) as SearxngResponse;
      },
      { retries: 1, shouldRetry: (e) => isRetryableStatus((e as { status?: number })?.status ?? 0) }
    );

    const seen = new Set<string>();
    const organicResults = (data.results || [])
      .filter((r) => r.url && !seen.has(r.url) && (seen.add(r.url), true))
      .slice(0, 20)
      .map((r, index) => ({
        title: r.title || "",
        url: r.url || "",
        position: index + 1,
      }));

    if (organicResults.length === 0) {
      return { success: false, error: "SearXNG returned no results (is JSON format enabled?)" };
    }

    const domainLower = brandDomain.toLowerCase().replace(/^www\./, "");
    const brandInResults = organicResults.some((r) => r.url.toLowerCase().includes(domainLower));

    const competitorInResults: Record<string, boolean> = {};
    for (const comp of competitors) {
      const compToken = comp.toLowerCase().replace(/\s+/g, "");
      competitorInResults[comp] = organicResults.some((r) => hostnameFromUrl(r.url).includes(compToken));
    }

    return {
      success: true,
      data: { organicResults, brandInResults, competitorInResults },
      creditsUsed: 0,
    };
  } catch (error) {
    logProviderError("searxng", error, { keyword });
    return { success: false, error: error instanceof Error ? error.message : "SearXNG request failed" };
  }
}
