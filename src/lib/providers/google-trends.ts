import { isOmniDataActive, labsApiPost } from "@/lib/providers/dataforseo";
import { logProviderError } from "@/lib/observability/log";

/**
 * Google Trends demand signal (relative interest, 0-100 — never absolute volume).
 * Prefers OmniData's keyless engine when deployed; otherwise calls the public
 * Google Trends explore -> widgetdata endpoints directly. Degrades to
 * { available: false } on rate-limits or parse failures.
 */

const TRENDS_BASE = "https://trends.google.com/trends/api";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface TrendPoint {
  date: string;
  value: number;
}

export interface KeywordTrends {
  keyword: string;
  geo: string;
  timeframe: string;
  trend_index: number;
  latest: number;
  momentum: number;
  timeline: TrendPoint[];
  related_top: string[];
  related_rising: string[];
  data_source: "google_trends";
  available: boolean;
}

interface ExploreWidget {
  id: string;
  token: string;
  request: unknown;
}

function emptyTrends(keyword: string, geo: string, timeframe: string): KeywordTrends {
  return {
    keyword,
    geo,
    timeframe,
    trend_index: 0,
    latest: 0,
    momentum: 0,
    timeline: [],
    related_top: [],
    related_rising: [],
    data_source: "google_trends",
    available: false,
  };
}

function parseGoogleJson<T>(text: string): T | null {
  try {
    return JSON.parse(text.replace(/^\)\]\}'?,?\s*/, "")) as T;
  } catch {
    return null;
  }
}

// Acquire a NID/consent cookie once (cached) to avoid Google Trends 429s.
let cachedCookie: { value: string; at: number } | null = null;
const COOKIE_TTL_MS = 30 * 60 * 1000;

async function getTrendsCookie(): Promise<string> {
  if (cachedCookie && Date.now() - cachedCookie.at < COOKIE_TTL_MS) {
    return cachedCookie.value;
  }
  try {
    const res = await fetch("https://trends.google.com/trends/explore?geo=US", {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", connection: "close" },
      signal: AbortSignal.timeout(12_000),
    });
    const sc = res.headers.get("set-cookie") || "";
    const value = sc
      .split(",")
      .map((s) => s.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
    cachedCookie = { value, at: Date.now() };
    return value;
  } catch {
    cachedCookie = { value: "", at: Date.now() };
    return "";
  }
}

async function trendsFetch(url: string): Promise<string | null> {
  try {
    const cookie = await getTrendsCookie();
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        connection: "close",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      logProviderError("google-trends.fetch", `HTTP ${res.status}`, { url });
      return null;
    }
    return await res.text();
  } catch (error) {
    logProviderError("google-trends.fetch", error, { url });
    return null;
  }
}

function summarize(points: TrendPoint[]): { trend_index: number; latest: number; momentum: number } {
  if (points.length === 0) return { trend_index: 0, latest: 0, momentum: 0 };
  const values = points.map((p) => p.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const latest = values[values.length - 1];
  const half = Math.floor(values.length / 2) || 1;
  const earlier = values.slice(0, half);
  const recent = values.slice(half);
  const eMean = earlier.reduce((a, b) => a + b, 0) / (earlier.length || 1);
  const rMean = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
  return {
    trend_index: Math.round(mean),
    latest: Math.round(latest),
    momentum: Math.max(-100, Math.min(100, Math.round(rMean - eMean))),
  };
}

async function getTrendsDirect(
  keyword: string,
  geo: string,
  timeframe: string
): Promise<KeywordTrends> {
  const req = {
    comparisonItem: [{ keyword, geo, time: timeframe }],
    category: 0,
    property: "",
  };
  const exploreUrl = `${TRENDS_BASE}/explore?hl=en-US&tz=0&req=${encodeURIComponent(
    JSON.stringify(req)
  )}`;
  const exploreText = await trendsFetch(exploreUrl);
  if (!exploreText) return emptyTrends(keyword, geo, timeframe);
  const widgets = parseGoogleJson<{ widgets?: ExploreWidget[] }>(exploreText)?.widgets || [];
  const timeWidget = widgets.find((w) => w.id === "TIMESERIES");
  const relatedWidget = widgets.find((w) => w.id === "RELATED_QUERIES");

  let timeline: TrendPoint[] = [];
  if (timeWidget) {
    const url = `${TRENDS_BASE}/widgetdata/multiline?hl=en-US&tz=0&req=${encodeURIComponent(
      JSON.stringify(timeWidget.request)
    )}&token=${encodeURIComponent(timeWidget.token)}`;
    const text = await trendsFetch(url);
    const data = text
      ? parseGoogleJson<{
          default?: {
            timelineData?: Array<{ formattedAxisTime?: string; time?: string; value?: number[] }>;
          };
        }>(text)
      : null;
    timeline = (data?.default?.timelineData || [])
      .map((t) => ({ date: t.formattedAxisTime || t.time || "", value: t.value?.[0] ?? 0 }))
      .filter((p) => p.date);
  }

  let relatedTop: string[] = [];
  let relatedRising: string[] = [];
  if (relatedWidget) {
    const url = `${TRENDS_BASE}/widgetdata/relatedsearches?hl=en-US&tz=0&req=${encodeURIComponent(
      JSON.stringify(relatedWidget.request)
    )}&token=${encodeURIComponent(relatedWidget.token)}`;
    const text = await trendsFetch(url);
    const data = text
      ? parseGoogleJson<{
          default?: { rankedList?: Array<{ rankedKeyword?: Array<{ query?: string }> }> };
        }>(text)
      : null;
    const lists = data?.default?.rankedList || [];
    relatedTop = (lists[0]?.rankedKeyword || []).map((k) => k.query || "").filter(Boolean).slice(0, 15);
    relatedRising = (lists[1]?.rankedKeyword || []).map((k) => k.query || "").filter(Boolean).slice(0, 15);
  }

  if (timeline.length === 0 && relatedTop.length === 0) return emptyTrends(keyword, geo, timeframe);
  const { trend_index, latest, momentum } = summarize(timeline);
  return {
    keyword,
    geo,
    timeframe,
    trend_index,
    latest,
    momentum,
    timeline,
    related_top: relatedTop,
    related_rising: relatedRising,
    data_source: "google_trends",
    available: timeline.length > 0 || relatedTop.length > 0,
  };
}

/**
 * Relative interest (0-100) for up to 5 keywords in ONE comparison request.
 * Returns a map keyword -> mean interest within the set. Used to extrapolate
 * absolute volume from a known-volume anchor keyword.
 */
export async function getTrendsComparison(
  keywords: string[],
  geo = "US",
  timeframe = "today 12-m"
): Promise<Map<string, number> | null> {
  const set = [...new Set(keywords)].filter(Boolean).slice(0, 5);
  if (set.length === 0) return null;
  const req = {
    comparisonItem: set.map((keyword) => ({ keyword, geo, time: timeframe })),
    category: 0,
    property: "",
  };
  const exploreText = await trendsFetch(
    `${TRENDS_BASE}/explore?hl=en-US&tz=0&req=${encodeURIComponent(JSON.stringify(req))}`
  );
  if (!exploreText) return null;
  const widgets = parseGoogleJson<{ widgets?: ExploreWidget[] }>(exploreText)?.widgets || [];
  const timeWidget = widgets.find((w) => w.id === "TIMESERIES");
  if (!timeWidget) return null;

  const text = await trendsFetch(
    `${TRENDS_BASE}/widgetdata/multiline?hl=en-US&tz=0&req=${encodeURIComponent(
      JSON.stringify(timeWidget.request)
    )}&token=${encodeURIComponent(timeWidget.token)}`
  );
  if (!text) return null;
  const data = parseGoogleJson<{
    default?: { timelineData?: Array<{ value?: number[] }> };
  }>(text);
  const timeline = data?.default?.timelineData || [];
  if (timeline.length === 0) return null;

  const out = new Map<string, number>();
  set.forEach((kw, idx) => {
    const vals = timeline
      .map((t) => t.value?.[idx])
      .filter((v): v is number => typeof v === "number");
    out.set(kw, vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0);
  });
  return out;
}

export async function getKeywordTrends(
  keyword: string,
  geo = "US",
  timeframe = "today 12-m"
): Promise<KeywordTrends> {
  if (isOmniDataActive()) {
    const res = await labsApiPost<{ tasks: Array<{ result: Array<KeywordTrends> }> }>(
      "/keywords/trends/live",
      [{ keyword, geo, timeframe }]
    );
    const data = res?.tasks?.[0]?.result?.[0];
    if (data && data.available) return data;
  }
  return getTrendsDirect(keyword, geo, timeframe);
}
