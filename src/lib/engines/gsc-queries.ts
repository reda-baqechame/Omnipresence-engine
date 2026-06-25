/** Fetch top search queries from Google Search Console for prompt seeding. */

export interface GscQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function fetchGscTopQueries(
  accessToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  rowLimit = 500
): Promise<GscQueryRow[]> {
  const normalizedSite = siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}/`;
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(normalizedSite)}/searchAnalytics/query`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ["query"],
        rowLimit: Math.min(rowLimit, 1000),
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
      rows?: Array<{
        keys: string[];
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
      }>;
    };

    return (data.rows || []).map((row) => ({
      query: row.keys[0] || "",
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    })).filter((r) => r.query.length > 2);
  } catch {
    return [];
  }
}
