/** Serper-based keyword research when Labs/OmniData unavailable. */

import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";

const SERPER_AUTOCOMPLETE = "https://google.serper.dev/autocomplete";

function hasSerper(): boolean {
  const key = process.env.SERPER_API_KEY;
  return Boolean(key && !key.startsWith("your-"));
}

export async function getKeywordSuggestionsSerper(seed: string): Promise<{
  seed: string;
  suggestions: Array<{ keyword: string; volume_estimate?: number; source?: string }>;
  related: Array<{ keyword: string; volume_estimate?: number }>;
} | null> {
  if (!hasSerper()) return null;

  try {
    const response = await fetch(SERPER_AUTOCOMPLETE, {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: seed }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { suggestions?: Array<{ value?: string }> };
    const suggestions = (data.suggestions || [])
      .map((s) => s.value)
      .filter((v): v is string => Boolean(v && v.length > 2))
      .slice(0, 15)
      .map((keyword) => ({ keyword, source: "serper_autocomplete" }));

    const related: Array<{ keyword: string; volume_estimate?: number }> = [];
    const serp = await searchGoogleOrganicRouter(seed, "United States", "", []);
    if (serp.success && serp.data?.organicResults) {
      for (const r of serp.data.organicResults.slice(0, 5)) {
        if (r.title && r.title.length > 10 && !related.some((x) => x.keyword === r.title)) {
          related.push({ keyword: r.title.slice(0, 120) });
        }
      }
    }

    if (!suggestions.length && !related.length) return null;
    return { seed, suggestions: suggestions.length ? suggestions : [{ keyword: seed, source: "serper" }], related };
  } catch {
    return null;
  }
}
