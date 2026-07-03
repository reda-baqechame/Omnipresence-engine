import type { ProviderResult } from "./types";
import { getGoogleCloudApiKey } from "./google-cloud-key";
import { getPageSpeedViaOmniData } from "./omnidata-performance";

/**
 * Google PageSpeed Insights — free Core Web Vitals + performance score.
 * Works keyless at low quota; set PAGESPEED_API_KEY to raise limits.
 * Slow pages time out during Perplexity/AI retrieval, so this feeds the
 * AEO technical-readiness lever directly.
 */

export interface CruxFieldData {
  /** Real-user p75 Largest Contentful Paint (ms). */
  lcpMs?: number;
  /** Real-user p75 Cumulative Layout Shift. */
  cls?: number;
  /** Real-user p75 Interaction to Next Paint (ms). */
  inpMs?: number;
  /** Overall Core Web Vitals assessment from real Chrome users. */
  assessment: "good" | "needs-improvement" | "poor" | "unknown";
}

export interface PageSpeedResult {
  /** 0-100 Lighthouse performance score */
  performanceScore: number;
  /** Largest Contentful Paint in ms (lab) */
  lcpMs: number;
  /** Cumulative Layout Shift (unitless) */
  cls: number;
  /** Total Blocking Time in ms (lab proxy for INP) */
  tbtMs: number;
  /** Interaction to Next Paint in ms (field data, when available) */
  inpMs?: number;
  /** Whether CrUX field data was present */
  hasFieldData: boolean;
  /** Real-user Core Web Vitals (CrUX, origin-level when available). */
  field?: CruxFieldData;
  strategy: "mobile" | "desktop";
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
  // CrUX reports CLS percentile scaled by 100 (e.g. 10 => 0.10).
  const clsRaw = metrics["CUMULATIVE_LAYOUT_SHIFT_SCORE"]?.percentile;
  const inp = metrics["INTERACTION_TO_NEXT_PAINT"]?.percentile;
  const overall = le?.overall_category;
  const assessment: CruxFieldData["assessment"] =
    overall === "FAST" ? "good" : overall === "AVERAGE" ? "needs-improvement" : overall === "SLOW" ? "poor" : "unknown";
  return {
    lcpMs: typeof lcp === "number" ? lcp : undefined,
    cls: typeof clsRaw === "number" ? Number((clsRaw / 100).toFixed(3)) : undefined,
    inpMs: typeof inp === "number" ? inp : undefined,
    assessment,
  };
}

export function hasPageSpeedCapability(): boolean {
  // Keyless calls work; capability is always available but rate-limited.
  return true;
}

// In-process TTL cache so a single scan (technical-audit + scoring) reuses one
// keyless call instead of hitting the rate-limited endpoint twice.
const PS_CACHE_TTL_MS = 10 * 60 * 1000;
const psCache = new Map<string, { at: number; result: ProviderResult<PageSpeedResult> }>();

export async function getPageSpeed(
  url: string,
  strategy: "mobile" | "desktop" = "mobile"
): Promise<ProviderResult<PageSpeedResult>> {
  const fullUrl = url.startsWith("http") ? url : `https://${url}`;
  const cacheKey = `${strategy}:${fullUrl}`;
  const cached = psCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PS_CACHE_TTL_MS) {
    return cached.result;
  }

  // Prefer the unified OmniData /v3 spine when configured; fall back to direct PSI.
  const viaOmni = await getPageSpeedViaOmniData(fullUrl, strategy);
  if (viaOmni) {
    psCache.set(cacheKey, { at: Date.now(), result: viaOmni });
    return viaOmni;
  }

  const key = getGoogleCloudApiKey();
  const params = new URLSearchParams({
    url: fullUrl,
    category: "performance",
    strategy,
  });
  if (key && !key.startsWith("your-")) params.set("key", key);

  const result = await fetchPageSpeed(fullUrl, strategy, params);
  psCache.set(cacheKey, { at: Date.now(), result });
  return result;
}

async function fetchPageSpeed(
  fullUrl: string,
  strategy: "mobile" | "desktop",
  params: URLSearchParams
): Promise<ProviderResult<PageSpeedResult>> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`,
      { signal: AbortSignal.timeout(30_000) }
    );

    if (!res.ok) {
      return { success: false, error: `PageSpeed API ${res.status}` };
    }

    const data = (await res.json()) as PSIResponse;
    const lh = data.lighthouseResult;
    const audits = lh?.audits || {};
    const score = lh?.categories?.performance?.score;

    if (typeof score !== "number") {
      return { success: false, error: "PageSpeed returned no performance score" };
    }

    const field = data.loadingExperience?.metrics || {};
    const inpField = field["INTERACTION_TO_NEXT_PAINT"]?.percentile;
    // Prefer origin-level CrUX for domain comparisons; fall back to page-level.
    const cruxField = parseCruxField(data.originLoadingExperience) || parseCruxField(data.loadingExperience);

    return {
      success: true,
      data: {
        performanceScore: Math.round(score * 100),
        lcpMs: Math.round(audits["largest-contentful-paint"]?.numericValue ?? 0),
        cls: Number((audits["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3)),
        tbtMs: Math.round(audits["total-blocking-time"]?.numericValue ?? 0),
        inpMs: typeof inpField === "number" ? inpField : undefined,
        hasFieldData: Object.keys(field).length > 0,
        field: cruxField,
        strategy,
      },
      creditsUsed: 0,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "PageSpeed request failed",
    };
  }
}

/** Normalize PageSpeed into a 0-100 AEO retrieval-health score. */
export function pageSpeedToRetrievalScore(ps: PageSpeedResult): number {
  // Performance score is the backbone; penalize poor Core Web Vitals that
  // cause retrieval timeouts. LCP > 4s and CLS > 0.25 are "poor" thresholds.
  let score = ps.performanceScore;
  if (ps.lcpMs > 4000) score -= 15;
  else if (ps.lcpMs > 2500) score -= 7;
  if (ps.cls > 0.25) score -= 10;
  else if (ps.cls > 0.1) score -= 5;
  if (ps.tbtMs > 600) score -= 10;
  else if (ps.tbtMs > 200) score -= 5;
  return Math.max(0, Math.min(100, score));
}
