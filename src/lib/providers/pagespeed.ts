import type { ProviderResult } from "./types";

/**
 * Google PageSpeed Insights provider — real Lighthouse lab scores + Chrome UX
 * Report (CrUX) field data. Lighthouse is Apache-2.0; the PSI API is free
 * (set PAGESPEED_API_KEY to lift the anonymous daily quota). All values here
 * are measured by Google, never estimated.
 *
 * Docs: https://developers.google.com/speed/docs/insights/v5/get-started
 */

const PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export type PageSpeedStrategy = "mobile" | "desktop";
export type PageSpeedCategory = "performance" | "seo" | "accessibility" | "best-practices";

export interface PageSpeedMetric {
  /** Distribution percentile / value from real Chrome users (CrUX field data). */
  percentile?: number;
  category?: "FAST" | "AVERAGE" | "SLOW";
}

export interface PageSpeedReport {
  url: string;
  strategy: PageSpeedStrategy;
  /** Lighthouse lab scores, 0–100. */
  scores: Partial<Record<PageSpeedCategory, number>>;
  /** Real-user Core Web Vitals from CrUX (undefined when the URL has no field data). */
  fieldData?: {
    overall?: "FAST" | "AVERAGE" | "SLOW";
    lcp?: PageSpeedMetric;
    cls?: PageSpeedMetric;
    inp?: PageSpeedMetric;
    fcp?: PageSpeedMetric;
  };
  hasFieldData: boolean;
  data_source: "measured";
}

const DEFAULT_CATEGORIES: PageSpeedCategory[] = ["performance", "seo", "accessibility", "best-practices"];

interface PsiResponse {
  lighthouseResult?: {
    categories?: Record<string, { score?: number | null }>;
  };
  loadingExperience?: {
    overall_category?: "FAST" | "AVERAGE" | "SLOW";
    metrics?: Record<string, { percentile?: number; category?: "FAST" | "AVERAGE" | "SLOW" }>;
  };
}

function toMetric(
  m?: { percentile?: number; category?: "FAST" | "AVERAGE" | "SLOW" }
): PageSpeedMetric | undefined {
  if (!m) return undefined;
  return { percentile: m.percentile, category: m.category };
}

export async function analyzePageSpeed(
  url: string,
  strategy: PageSpeedStrategy = "mobile",
  categories: PageSpeedCategory[] = DEFAULT_CATEGORIES
): Promise<ProviderResult<PageSpeedReport>> {
  try {
    const target = url.startsWith("http") ? url : `https://${url}`;
    const params = new URLSearchParams();
    params.set("url", target);
    params.set("strategy", strategy);
    for (const c of categories) params.append("category", c);
    if (process.env.PAGESPEED_API_KEY) params.set("key", process.env.PAGESPEED_API_KEY);

    const response = await fetch(`${PSI_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(60000),
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return { success: false, error: `PageSpeed API error: ${response.status}` };
    }

    const data = (await response.json()) as PsiResponse;
    const lhCategories = data.lighthouseResult?.categories || {};

    const scores: Partial<Record<PageSpeedCategory, number>> = {};
    for (const c of categories) {
      const raw = lhCategories[c]?.score;
      if (typeof raw === "number") scores[c] = Math.round(raw * 100);
    }

    const fieldMetrics = data.loadingExperience?.metrics;
    const hasFieldData = Boolean(fieldMetrics && Object.keys(fieldMetrics).length > 0);

    const report: PageSpeedReport = {
      url: target,
      strategy,
      scores,
      hasFieldData,
      data_source: "measured",
    };

    if (hasFieldData && fieldMetrics) {
      report.fieldData = {
        overall: data.loadingExperience?.overall_category,
        lcp: toMetric(fieldMetrics.LARGEST_CONTENTFUL_PAINT_MS),
        cls: toMetric(fieldMetrics.CUMULATIVE_LAYOUT_SHIFT_SCORE),
        inp: toMetric(fieldMetrics.INTERACTION_TO_NEXT_PAINT),
        fcp: toMetric(fieldMetrics.FIRST_CONTENTFUL_PAINT_MS),
      };
    }

    return { success: true, data: report, creditsUsed: 1 };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "PageSpeed request failed",
    };
  }
}
