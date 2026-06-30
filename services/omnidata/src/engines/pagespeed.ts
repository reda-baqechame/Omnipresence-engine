/**
 * Google PageSpeed Insights + CrUX field data through the OmniData /v3 spine.
 *
 * Unifies real-user Core Web Vitals (CrUX) and lab performance into the sovereign
 * data cloud so every consumer hits one spine. Keyless at low quota; set
 * PAGESPEED_API_KEY to raise limits. Degrades to { available:false } on failure.
 */

export interface CruxFieldData {
  lcp_ms?: number;
  cls?: number;
  inp_ms?: number;
  assessment: "good" | "needs-improvement" | "poor" | "unknown";
}

export interface PageSpeedResult {
  available: boolean;
  reason?: string;
  url: string;
  strategy: "mobile" | "desktop";
  performance_score: number;
  lcp_ms: number;
  cls: number;
  tbt_ms: number;
  inp_ms?: number;
  has_field_data: boolean;
  field?: CruxFieldData;
  /** "pagespeed_with_crux" when real-user CrUX present, else "lab_only". */
  data_source: "pagespeed_with_crux" | "lab_only" | "unavailable";
}

interface PSIAudit {
  numericValue?: number;
}
interface PSILoadingExperience {
  metrics?: Record<string, { percentile?: number; category?: string }>;
  overall_category?: string;
}
interface PSIResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number } };
    audits?: Record<string, PSIAudit>;
  };
  loadingExperience?: PSILoadingExperience;
  originLoadingExperience?: PSILoadingExperience;
}

function parseCruxField(le?: PSILoadingExperience): CruxFieldData | undefined {
  const metrics = le?.metrics;
  if (!metrics || Object.keys(metrics).length === 0) return undefined;
  const lcp = metrics["LARGEST_CONTENTFUL_PAINT_MS"]?.percentile;
  const clsRaw = metrics["CUMULATIVE_LAYOUT_SHIFT_SCORE"]?.percentile;
  const inp = metrics["INTERACTION_TO_NEXT_PAINT"]?.percentile;
  const overall = le?.overall_category;
  const assessment: CruxFieldData["assessment"] =
    overall === "FAST" ? "good" : overall === "AVERAGE" ? "needs-improvement" : overall === "SLOW" ? "poor" : "unknown";
  return {
    lcp_ms: typeof lcp === "number" ? lcp : undefined,
    cls: typeof clsRaw === "number" ? Number((clsRaw / 100).toFixed(3)) : undefined,
    inp_ms: typeof inp === "number" ? inp : undefined,
    assessment,
  };
}

export async function getPageSpeed(
  url: string,
  strategy: "mobile" | "desktop" = "mobile"
): Promise<PageSpeedResult> {
  const fullUrl = url.startsWith("http") ? url : `https://${url}`;
  const unavailable = (reason: string): PageSpeedResult => ({
    available: false,
    reason,
    url: fullUrl,
    strategy,
    performance_score: 0,
    lcp_ms: 0,
    cls: 0,
    tbt_ms: 0,
    has_field_data: false,
    data_source: "unavailable",
  });

  const key = process.env.PAGESPEED_API_KEY;
  const params = new URLSearchParams({ url: fullUrl, category: "performance", strategy });
  if (key && !key.startsWith("your-")) params.set("key", key);

  try {
    const res = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`,
      { signal: AbortSignal.timeout(30_000) }
    );
    if (!res.ok) return unavailable(`PageSpeed API ${res.status}`);
    const data = (await res.json()) as PSIResponse;
    const lh = data.lighthouseResult;
    const audits = lh?.audits || {};
    const score = lh?.categories?.performance?.score;
    if (typeof score !== "number") return unavailable("PageSpeed returned no performance score");

    const field = data.loadingExperience?.metrics || {};
    const inpField = field["INTERACTION_TO_NEXT_PAINT"]?.percentile;
    const cruxField = parseCruxField(data.originLoadingExperience) || parseCruxField(data.loadingExperience);
    const hasField = Object.keys(field).length > 0;

    return {
      available: true,
      url: fullUrl,
      strategy,
      performance_score: Math.round(score * 100),
      lcp_ms: Math.round(audits["largest-contentful-paint"]?.numericValue ?? 0),
      cls: Number((audits["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3)),
      tbt_ms: Math.round(audits["total-blocking-time"]?.numericValue ?? 0),
      inp_ms: typeof inpField === "number" ? inpField : undefined,
      has_field_data: hasField,
      field: cruxField,
      data_source: cruxField ? "pagespeed_with_crux" : "lab_only",
    };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "PageSpeed request failed");
  }
}
