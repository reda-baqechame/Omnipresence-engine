import type { ProviderResult } from "./types";
import { fetchWithTimeout } from "./http";

/**
 * Microsoft Clarity — free behavioral analytics (heatmaps, scroll depth,
 * dead/rage clicks, quickbacks). Uses the Clarity Data Export API, which is
 * keyed by a free, per-project API token generated in Clarity → Settings →
 * Data Export. No paid tier, no credit card.
 *
 * API: GET https://www.clarity.ms/export-data/api/v1/project-live-insights
 *   ?numOfDays=1..3 [&dimension1=URL|Device|Country|OS|Browser]
 *   Authorization: Bearer <project token>
 *
 * Returns one entry per metric; with dimension1=URL each metric carries a
 * per-URL breakdown. We normalize the noisy shape into typed per-URL rows.
 */

const CLARITY_URL = "https://www.clarity.ms/export-data/api/v1/project-live-insights";

export interface ClarityUrlMetric {
  url: string;
  sessions: number;
  /** Average scroll depth as a 0-100 percentage. */
  scrollDepthPct?: number;
  /** Average engagement time in seconds. */
  engagementTimeSec?: number;
  deadClicks: number;
  rageClicks: number;
  quickbacks: number;
  excessiveScroll: number;
}

export interface ClarityInsights {
  totalSessions: number;
  botSessions: number;
  distinctUsers: number;
  pagesPerSession?: number;
  urls: ClarityUrlMetric[];
  numOfDays: number;
}

interface ClarityMetricInfo {
  Url?: string;
  url?: string;
  totalSessionCount?: string | number;
  totalBotSessionCount?: string | number;
  distinctUserCount?: string | number;
  pagesPerSessionPercentage?: string | number;
  averageScrollDepth?: string | number;
  totalTime?: string | number;
  activeTime?: string | number;
  subTotal?: string | number;
  sessionsCount?: string | number;
  sessionsWithMetricPercentage?: string | number;
}

interface ClarityMetric {
  metricName: string;
  information?: ClarityMetricInfo[];
}

function num(v: string | number | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Resolve the Clarity token: per-project token preferred, org-wide env fallback. */
export function resolveClarityToken(projectToken?: string | null): string | null {
  if (projectToken && projectToken.trim()) return projectToken.trim();
  const env = process.env.CLARITY_API_TOKEN;
  if (env && env.trim() && !env.startsWith("your-")) return env.trim();
  return null;
}

export function hasClarityCapability(projectToken?: string | null): boolean {
  return resolveClarityToken(projectToken) != null;
}

export async function getClarityInsights(
  token: string,
  numOfDays: 1 | 2 | 3 = 3
): Promise<ProviderResult<ClarityInsights>> {
  try {
    const params = new URLSearchParams({ numOfDays: String(numOfDays), dimension1: "URL" });
    const res = await fetchWithTimeout(`${CLARITY_URL}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 20_000,
    });

    if (res.status === 401 || res.status === 403) {
      return { success: false, error: "Clarity token invalid or expired" };
    }
    if (res.status === 429) {
      return { success: false, error: "Clarity rate limit (10 req/project/day)" };
    }
    if (!res.ok) {
      return { success: false, error: `Clarity API ${res.status}` };
    }

    const metrics = (await res.json()) as ClarityMetric[];
    if (!Array.isArray(metrics)) {
      return { success: false, error: "Clarity returned an unexpected shape" };
    }

    const insights = normalizeInsights(metrics, numOfDays);
    return { success: true, data: insights, creditsUsed: 0 };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Clarity request failed",
    };
  }
}

function normalizeInsights(metrics: ClarityMetric[], numOfDays: number): ClarityInsights {
  const byMetric = new Map<string, ClarityMetricInfo[]>();
  for (const m of metrics) {
    byMetric.set(m.metricName, m.information || []);
  }

  const traffic = byMetric.get("Traffic")?.[0];
  const urls = new Map<string, ClarityUrlMetric>();

  function ensure(url: string): ClarityUrlMetric {
    const key = url || "(unknown)";
    let row = urls.get(key);
    if (!row) {
      row = {
        url: key,
        sessions: 0,
        deadClicks: 0,
        rageClicks: 0,
        quickbacks: 0,
        excessiveScroll: 0,
      };
      urls.set(key, row);
    }
    return row;
  }

  for (const info of byMetric.get("Traffic") || []) {
    const url = info.Url || info.url;
    if (!url) continue;
    const row = ensure(url);
    row.sessions = num(info.totalSessionCount);
  }
  for (const info of byMetric.get("ScrollDepth") || []) {
    const url = info.Url || info.url;
    if (!url) continue;
    ensure(url).scrollDepthPct = num(info.averageScrollDepth);
  }
  for (const info of byMetric.get("EngagementTime") || []) {
    const url = info.Url || info.url;
    if (!url) continue;
    ensure(url).engagementTimeSec = num(info.activeTime) || num(info.totalTime);
  }
  for (const info of byMetric.get("DeadClickCount") || []) {
    const url = info.Url || info.url;
    if (!url) continue;
    ensure(url).deadClicks = num(info.subTotal);
  }
  for (const info of byMetric.get("RageClickCount") || []) {
    const url = info.Url || info.url;
    if (!url) continue;
    ensure(url).rageClicks = num(info.subTotal);
  }
  for (const info of byMetric.get("QuickbackClick") || []) {
    const url = info.Url || info.url;
    if (!url) continue;
    ensure(url).quickbacks = num(info.subTotal);
  }
  for (const info of byMetric.get("ExcessiveScroll") || []) {
    const url = info.Url || info.url;
    if (!url) continue;
    ensure(url).excessiveScroll = num(info.subTotal);
  }

  const totalSessions = num(traffic?.totalSessionCount);
  return {
    totalSessions,
    botSessions: num(traffic?.totalBotSessionCount),
    distinctUsers: num(traffic?.distinctUserCount),
    pagesPerSession: traffic?.pagesPerSessionPercentage != null ? num(traffic.pagesPerSessionPercentage) : undefined,
    urls: [...urls.values()].sort((a, b) => b.sessions - a.sessions),
    numOfDays,
  };
}
