import { fetchWithTimeout } from "./http";

export interface BingQueryRow {
  query: string;
  clicks: number;
  impressions: number;
}

/** Fetch per-query stats from Bing Webmaster (real first-party volume proxy). */
export async function fetchBingQueryKeywords(
  accessToken: string,
  siteUrl: string,
  limit = 50
): Promise<{ available: boolean; rows: BingQueryRow[] }> {
  try {
    const res = await fetchWithTimeout(
      `https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats?siteUrl=${encodeURIComponent(siteUrl)}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeoutMs: 20000 }
    );
    if (!res.ok) return { available: false, rows: [] };
    const data = (await res.json()) as {
      d?: Array<{ Query?: string; Clicks?: number; Impressions?: number }>;
    };
    const rows = (data.d || [])
      .filter((r) => r.Query)
      .map((r) => ({
        query: r.Query!,
        clicks: r.Clicks ?? 0,
        impressions: r.Impressions ?? 0,
      }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, limit);
    return { available: rows.length > 0, rows };
  } catch {
    return { available: false, rows: [] };
  }
}
