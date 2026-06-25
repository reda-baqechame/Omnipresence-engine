import type { ProviderResult } from "./types";

/**
 * Google PageSpeed Insights — free Core Web Vitals + performance score.
 * Works keyless at low quota; set PAGESPEED_API_KEY to raise limits.
 * Slow pages time out during Perplexity/AI retrieval, so this feeds the
 * AEO technical-readiness lever directly.
 */

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
  strategy: "mobile" | "desktop";
}

interface PSIAudit {
  numericValue?: number;
}

interface PSIResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number } };
    audits?: Record<string, PSIAudit>;
  };
  loadingExperience?: {
    metrics?: Record<string, { percentile?: number }>;
  };
}

export function hasPageSpeedCapability(): boolean {
  // Keyless calls work; capability is always available but rate-limited.
  return true;
}

export async function getPageSpeed(
  url: string,
  strategy: "mobile" | "desktop" = "mobile"
): Promise<ProviderResult<PageSpeedResult>> {
  const fullUrl = url.startsWith("http") ? url : `https://${url}`;
  const key = process.env.PAGESPEED_API_KEY;
  const params = new URLSearchParams({
    url: fullUrl,
    category: "performance",
    strategy,
  });
  if (key && !key.startsWith("your-")) params.set("key", key);

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

    return {
      success: true,
      data: {
        performanceScore: Math.round(score * 100),
        lcpMs: Math.round(audits["largest-contentful-paint"]?.numericValue ?? 0),
        cls: Number((audits["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3)),
        tbtMs: Math.round(audits["total-blocking-time"]?.numericValue ?? 0),
        inpMs: typeof inpField === "number" ? inpField : undefined,
        hasFieldData: Object.keys(field).length > 0,
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
