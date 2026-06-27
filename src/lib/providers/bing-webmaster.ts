/**
 * Bing Webmaster Tools API — sitemap submission + AI Performance citations
 */
import { fetchWithTimeout } from "./http";

export interface BingAIPerformance {
  citations: number;
  impressions: number;
  clicks: number;
}

export async function submitBingSitemap(
  accessToken: string,
  siteUrl: string,
  sitemapUrl: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const encodedSite = encodeURIComponent(siteUrl);
    const response = await fetchWithTimeout(
      `https://ssl.bing.com/webmaster/api.svc/json/SubmitFeed?apikey=${accessToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteUrl,
          feedUrl: sitemapUrl,
        }),
        timeoutMs: 20000,
      }
    );
    return { success: response.ok };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Bing sitemap submit failed",
    };
  }
}

export async function fetchBingAIPerformance(
  accessToken: string,
  siteUrl: string
): Promise<{ success: boolean; data?: BingAIPerformance; error?: string }> {
  try {
    const response = await fetchWithTimeout(
      `https://ssl.bing.com/webmaster/api.svc/json/GetUrlTrafficInfo?siteUrl=${encodeURIComponent(siteUrl)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeoutMs: 20000,
      }
    );

    if (!response.ok) {
      return { success: false, error: `Bing API ${response.status}` };
    }

    const data = await response.json() as {
      d?: Array<{ Clicks?: number; Impressions?: number; AICitations?: number }>;
    };

    const rows = data.d || [];
    const totals = rows.reduce(
      (acc, r) => ({
        clicks: acc.clicks + (r.Clicks || 0),
        impressions: acc.impressions + (r.Impressions || 0),
        citations: acc.citations + (r.AICitations || 0),
      }),
      { clicks: 0, impressions: 0, citations: 0 }
    );

    return { success: true, data: totals };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Bing AI performance fetch failed",
    };
  }
}

export async function submitBingUrls(
  accessToken: string,
  siteUrl: string,
  urls: string[]
): Promise<{ success: boolean; submitted: number }> {
  let submitted = 0;
  for (const url of urls.slice(0, 10)) {
    try {
      const response = await fetchWithTimeout(
        "https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch?apikey=" + accessToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteUrl, urlList: [url] }),
          timeoutMs: 20000,
        }
      );
      if (response.ok) submitted++;
    } catch {
      // continue
    }
  }
  return { success: submitted > 0, submitted };
}
