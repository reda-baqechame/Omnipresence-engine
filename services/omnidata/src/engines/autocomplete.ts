/**
 * Keyless autocomplete collectors (Phase 3).
 * Google/Bing/YouTube suggest endpoints where possible without paid keys.
 */

export interface AutocompleteSuggestion {
  keyword: string;
  source: "google" | "bing" | "youtube";
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "PresenceOS-OmniData/1.0" } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Google autocomplete (unofficial client=firefox endpoint). */
export async function googleAutocomplete(query: string, hl = "en"): Promise<AutocompleteSuggestion[]> {
  const q = encodeURIComponent(query.trim());
  if (!q) return [];
  const data = await fetchJson(
    `https://suggestqueries.google.com/complete/search?client=firefox&q=${q}&hl=${hl}`
  );
  if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
  return (data[1] as string[]).slice(0, 10).map((keyword) => ({ keyword, source: "google" as const }));
}

/** Bing autosuggest (public endpoint). */
export async function bingAutocomplete(query: string, mkt = "en-US"): Promise<AutocompleteSuggestion[]> {
  const q = encodeURIComponent(query.trim());
  if (!q) return [];
  const data = (await fetchJson(
    `https://api.bing.com/osjson.aspx?query=${q}&mkt=${mkt}`
  )) as unknown;
  if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
  return (data[1] as string[]).slice(0, 10).map((keyword) => ({ keyword, source: "bing" as const }));
}

/** YouTube search suggest. */
export async function youtubeAutocomplete(query: string): Promise<AutocompleteSuggestion[]> {
  const q = encodeURIComponent(query.trim());
  if (!q) return [];
  const data = (await fetchJson(
    `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${q}`
  )) as unknown;
  if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
  return (data[1] as string[]).slice(0, 10).map((keyword) => ({ keyword, source: "youtube" as const }));
}

export async function collectAutocomplete(
  query: string,
  sources: Array<"google" | "bing" | "youtube"> = ["google", "bing", "youtube"]
): Promise<AutocompleteSuggestion[]> {
  const tasks: Promise<AutocompleteSuggestion[]>[] = [];
  if (sources.includes("google")) tasks.push(googleAutocomplete(query));
  if (sources.includes("bing")) tasks.push(bingAutocomplete(query));
  if (sources.includes("youtube")) tasks.push(youtubeAutocomplete(query));
  const batches = await Promise.all(tasks);
  const seen = new Set<string>();
  const out: AutocompleteSuggestion[] = [];
  for (const batch of batches) {
    for (const s of batch) {
      const k = s.keyword.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
  }
  return out.slice(0, 25);
}
