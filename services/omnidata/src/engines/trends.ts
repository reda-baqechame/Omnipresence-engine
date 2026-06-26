/**
 * Keyless Google Trends engine (pytrends-style explore -> widgetdata flow).
 *
 * Google Trends has no official public API, but the same endpoints the
 * trends.google.com UI calls are reachable without an API key. We:
 *   1. POST/GET /trends/api/explore to obtain a widget token + request blob
 *   2. GET /trends/api/widgetdata/multiline for interest-over-time (0-100)
 *   3. GET /trends/api/widgetdata/relatedsearches for top + rising queries
 *
 * All values are RELATIVE interest (0-100), never absolute search volume, so
 * callers must label them as a demand index, not a count. Everything degrades
 * gracefully to { available: false } on rate-limits or parse failures.
 */

const TRENDS_BASE = "https://trends.google.com/trends/api";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface TrendPoint {
  date: string;
  value: number;
}

export interface TrendsResult {
  keyword: string;
  geo: string;
  timeframe: string;
  /** Mean relative interest over the window (0-100). */
  trend_index: number;
  /** Most recent data point (0-100). */
  latest: number;
  /** Recent-half vs earlier-half momentum, -100..100. */
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

/** Strip Google's anti-JSON-hijacking prefix ()]}',) and parse. */
function parseGoogleJson<T>(text: string): T | null {
  try {
    const cleaned = text.replace(/^\)\]\}'?,?\s*/, "");
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

async function trendsFetch(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function getExploreWidgets(
  keywords: string[],
  geo: string,
  timeframe: string
): Promise<ExploreWidget[] | null> {
  const req = {
    comparisonItem: keywords.map((keyword) => ({
      keyword,
      geo,
      time: timeframe,
    })),
    category: 0,
    property: "",
  };
  const url = `${TRENDS_BASE}/explore?hl=en-US&tz=0&req=${encodeURIComponent(
    JSON.stringify(req)
  )}`;
  const text = await trendsFetch(url);
  if (!text) return null;
  const data = parseGoogleJson<{ widgets?: ExploreWidget[] }>(text);
  return data?.widgets || null;
}

interface MultilineResponse {
  default?: {
    timelineData?: Array<{
      formattedAxisTime?: string;
      time?: string;
      value?: number[];
    }>;
  };
}

interface RelatedResponse {
  default?: {
    rankedList?: Array<{
      rankedKeyword?: Array<{ query?: string; value?: number }>;
    }>;
  };
}

function summarizeTimeline(points: TrendPoint[]): {
  trend_index: number;
  latest: number;
  momentum: number;
} {
  if (points.length === 0) return { trend_index: 0, latest: 0, momentum: 0 };
  const values = points.map((p) => p.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const latest = values[values.length - 1];
  const half = Math.floor(values.length / 2) || 1;
  const earlier = values.slice(0, half);
  const recent = values.slice(half);
  const earlierMean = earlier.reduce((a, b) => a + b, 0) / (earlier.length || 1);
  const recentMean = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
  const momentum = Math.max(-100, Math.min(100, Math.round(recentMean - earlierMean)));
  return { trend_index: Math.round(mean), latest: Math.round(latest), momentum };
}

/**
 * Comparison interest for up to 5 keywords in a single request. Returns a map
 * keyword -> mean relative interest (0-100) within the comparison set.
 */
export async function getTrendsComparison(
  keywords: string[],
  geo = "US",
  timeframe = "today 12-m"
): Promise<Map<string, number> | null> {
  const set = keywords.slice(0, 5).filter(Boolean);
  if (set.length === 0) return null;
  const widgets = await getExploreWidgets(set, geo, timeframe);
  const timeWidget = widgets?.find((w) => w.id === "TIMESERIES");
  if (!timeWidget) return null;

  const url = `${TRENDS_BASE}/widgetdata/multiline?hl=en-US&tz=0&req=${encodeURIComponent(
    JSON.stringify(timeWidget.request)
  )}&token=${encodeURIComponent(timeWidget.token)}`;
  const text = await trendsFetch(url);
  if (!text) return null;
  const data = parseGoogleJson<MultilineResponse>(text);
  const timeline = data?.default?.timelineData || [];
  if (timeline.length === 0) return null;

  const out = new Map<string, number>();
  set.forEach((kw, idx) => {
    const vals = timeline
      .map((t) => t.value?.[idx])
      .filter((v): v is number => typeof v === "number");
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    out.set(kw, Math.round(mean));
  });
  return out;
}

/** Full single-keyword trend: interest-over-time + related/rising queries. */
export async function getTrends(
  keyword: string,
  geo = "US",
  timeframe = "today 12-m"
): Promise<TrendsResult> {
  const empty: TrendsResult = {
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

  const widgets = await getExploreWidgets([keyword], geo, timeframe);
  if (!widgets) return empty;

  const timeWidget = widgets.find((w) => w.id === "TIMESERIES");
  const relatedWidget = widgets.find((w) => w.id === "RELATED_QUERIES");

  let timeline: TrendPoint[] = [];
  if (timeWidget) {
    const url = `${TRENDS_BASE}/widgetdata/multiline?hl=en-US&tz=0&req=${encodeURIComponent(
      JSON.stringify(timeWidget.request)
    )}&token=${encodeURIComponent(timeWidget.token)}`;
    const text = await trendsFetch(url);
    const data = text ? parseGoogleJson<MultilineResponse>(text) : null;
    timeline = (data?.default?.timelineData || [])
      .map((t) => ({
        date: t.formattedAxisTime || t.time || "",
        value: t.value?.[0] ?? 0,
      }))
      .filter((p) => p.date);
  }

  let relatedTop: string[] = [];
  let relatedRising: string[] = [];
  if (relatedWidget) {
    const url = `${TRENDS_BASE}/widgetdata/relatedsearches?hl=en-US&tz=0&req=${encodeURIComponent(
      JSON.stringify(relatedWidget.request)
    )}&token=${encodeURIComponent(relatedWidget.token)}`;
    const text = await trendsFetch(url);
    const data = text ? parseGoogleJson<RelatedResponse>(text) : null;
    const lists = data?.default?.rankedList || [];
    relatedTop = (lists[0]?.rankedKeyword || [])
      .map((k) => k.query || "")
      .filter(Boolean)
      .slice(0, 15);
    relatedRising = (lists[1]?.rankedKeyword || [])
      .map((k) => k.query || "")
      .filter(Boolean)
      .slice(0, 15);
  }

  if (timeline.length === 0 && relatedTop.length === 0) return empty;

  const { trend_index, latest, momentum } = summarizeTimeline(timeline);
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
