import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";

/**
 * GDELT DOC 2.0 — global news monitoring, 100% keyless and free.
 * Indexes worldwide online news in near-real-time. We use it for brand/news
 * mention discovery and tone (GDELT's built-in sentiment).
 *
 * Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 */

const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";

export interface GdeltArticle {
  url: string;
  title: string;
  domain: string;
  language?: string;
  sourceCountry?: string;
  seenDate?: string;
  /** GDELT social-image/tone if requested; tone is -100..100. */
  tone?: number;
}

interface GdeltResponse {
  articles?: Array<{
    url?: string;
    title?: string;
    domain?: string;
    language?: string;
    sourcecountry?: string;
    seendate?: string;
  }>;
}

export function hasGdeltCapability(): boolean {
  return true; // keyless
}

export async function searchGdeltNews(
  query: string,
  options: { timespanDays?: number; maxRecords?: number } = {}
): Promise<{ available: boolean; reason?: string; articles: GdeltArticle[] }> {
  const q = query.trim();
  if (!q) return { available: false, reason: "Empty query", articles: [] };

  const params = new URLSearchParams({
    query: q,
    mode: "ArtList",
    format: "json",
    maxrecords: String(Math.min(75, options.maxRecords ?? 50)),
    timespan: `${Math.min(365, options.timespanDays ?? 30)}d`,
    sort: "DateDesc",
  });

  try {
    const res = await fetchWithTimeout(`${GDELT_URL}?${params}`, {
      headers: { "User-Agent": "PresenceOS/1.0" },
      timeoutMs: 20_000,
    });
    if (!res.ok) {
      return { available: false, reason: `GDELT ${res.status}`, articles: [] };
    }
    // GDELT occasionally returns an HTML error page on malformed queries.
    const text = await res.text();
    let data: GdeltResponse;
    try {
      data = JSON.parse(text) as GdeltResponse;
    } catch {
      return { available: false, reason: "GDELT returned no parseable results", articles: [] };
    }
    const articles: GdeltArticle[] = (data.articles || [])
      .filter((a) => a.url && a.title)
      .map((a) => ({
        url: a.url!,
        title: a.title!,
        domain: a.domain || hostOf(a.url!),
        language: a.language,
        sourceCountry: a.sourcecountry,
        seenDate: a.seendate,
      }));
    return { available: true, articles };
  } catch (error) {
    logProviderError("gdelt", error, { query: q });
    return { available: false, reason: error instanceof Error ? error.message : "GDELT failed", articles: [] };
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
