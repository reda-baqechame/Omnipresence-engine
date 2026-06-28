/** Fetch top search queries from Google Search Console for prompt seeding. */

import { selectPagesToRefresh, type PseoRefreshCandidate } from "@/lib/engines/programmatic-seo";
import { logProviderError } from "@/lib/observability/log";

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
  } catch (error) {
    logProviderError("gsc.topQueries", error, { siteUrl });
    return [];
  }
}

export interface GscPositionEntry {
  position: number;
  impressions: number;
  clicks: number;
}

/**
 * First-party rank truth: a map of `query -> avg position` from Search Console
 * over the last 28 days. This is the user's *actual* measured ranking (not a
 * public SERP scrape that can differ by personalization/locale), so the rank
 * tracker prefers it when available. Only covers queries the site already
 * appears for; everything else falls back to the public SERP.
 */
export async function buildGscPositionMap(
  accessToken: string,
  siteUrl: string
): Promise<Map<string, GscPositionEntry>> {
  const rows = await fetchGscTopQueries(
    accessToken,
    siteUrl,
    isoDaysAgo(28),
    isoDaysAgo(1),
    1000
  );
  const map = new Map<string, GscPositionEntry>();
  for (const r of rows) {
    map.set(r.query.trim().toLowerCase(), {
      position: r.position,
      impressions: r.impressions,
      clicks: r.clicks,
    });
  }
  return map;
}

export interface GscPageRow {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** Per-page Search Console performance — feeds the programmatic-SEO refresh loop. */
export async function fetchGscPagePerformance(
  accessToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  rowLimit = 1000
): Promise<GscPageRow[]> {
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
        dimensions: ["page"],
        rowLimit: Math.min(rowLimit, 25000),
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
      url: row.keys[0] || "",
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    })).filter((r) => r.url.startsWith("http"));
  } catch (error) {
    logProviderError("gsc.pagePerformance", error, { siteUrl });
    return [];
  }
}

function expectedCtrByPosition(position: number): number {
  if (position <= 1) return 0.28;
  if (position <= 2) return 0.15;
  if (position <= 3) return 0.1;
  if (position <= 5) return 0.06;
  if (position <= 10) return 0.025;
  return 0.01;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export interface GscDecayRow {
  url: string;
  prevImpressions: number;
  currImpressions: number;
  impressionDelta: number;
  prevClicks: number;
  currClicks: number;
  clickDelta: number;
}

export interface GscInsights {
  available: true;
  range: { current: { start: string; end: string }; previous: { start: string; end: string } };
  totals: { clicks: number; impressions: number; ctr: number; avgPosition: number };
  topQueries: GscQueryRow[];
  topPages: GscPageRow[];
  strikingDistance: GscQueryRow[];
  lowCtr: GscQueryRow[];
  decay: GscDecayRow[];
  refreshCandidates: PseoRefreshCandidate[];
}

/**
 * One-call GSC insights: top queries/pages, striking-distance, low-CTR, and
 * content decay (current 28d vs prior 28d). This is free, refund-proof ground
 * truth a pro can verify against their own Search Console.
 */
export async function buildGscInsights(
  accessToken: string,
  siteUrl: string
): Promise<GscInsights> {
  const curStart = isoDaysAgo(28);
  const curEnd = isoDaysAgo(1);
  const prevStart = isoDaysAgo(56);
  const prevEnd = isoDaysAgo(29);

  const [queries, pages, prevPages] = await Promise.all([
    fetchGscTopQueries(accessToken, siteUrl, curStart, curEnd, 500),
    fetchGscPagePerformance(accessToken, siteUrl, curStart, curEnd, 1000),
    fetchGscPagePerformance(accessToken, siteUrl, prevStart, prevEnd, 1000),
  ]);

  const totalsClicks = queries.reduce((s, q) => s + q.clicks, 0);
  const totalsImpr = queries.reduce((s, q) => s + q.impressions, 0);
  const avgPosition = queries.length
    ? queries.reduce((s, q) => s + q.position, 0) / queries.length
    : 0;

  const strikingDistance = queries
    .filter((q) => q.position > 3 && q.position <= 20 && q.impressions >= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 50);

  const lowCtr = queries
    .filter((q) => q.impressions >= 50 && q.ctr < expectedCtrByPosition(q.position) * 0.5 && q.position <= 15)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 50);

  const prevByUrl = new Map(prevPages.map((p) => [p.url, p]));
  const decay: GscDecayRow[] = [];
  for (const p of pages) {
    const prev = prevByUrl.get(p.url);
    if (!prev) continue;
    const impressionDelta = p.impressions - prev.impressions;
    const clickDelta = p.clicks - prev.clicks;
    // Decaying = meaningful prior impressions and a >=20% impression loss.
    if (prev.impressions >= 50 && impressionDelta < 0 && impressionDelta <= -prev.impressions * 0.2) {
      decay.push({
        url: p.url,
        prevImpressions: prev.impressions,
        currImpressions: p.impressions,
        impressionDelta,
        prevClicks: prev.clicks,
        currClicks: p.clicks,
        clickDelta,
      });
    }
  }
  decay.sort((a, b) => a.impressionDelta - b.impressionDelta);

  const refreshCandidates = selectPagesToRefresh(pages, { minImpressions: 50 }).slice(0, 50);

  return {
    available: true,
    range: { current: { start: curStart, end: curEnd }, previous: { start: prevStart, end: prevEnd } },
    totals: {
      clicks: totalsClicks,
      impressions: totalsImpr,
      ctr: totalsImpr ? totalsClicks / totalsImpr : 0,
      avgPosition,
    },
    topQueries: [...queries].sort((a, b) => b.clicks - a.clicks).slice(0, 50),
    topPages: [...pages].sort((a, b) => b.clicks - a.clicks).slice(0, 50),
    strikingDistance,
    lowCtr,
    decay: decay.slice(0, 50),
    refreshCandidates,
  };
}
