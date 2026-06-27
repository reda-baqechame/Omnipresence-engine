import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";

/**
 * Chrome UX Report (CrUX) History API — free real-user Core Web Vitals trends
 * (~25 weekly collection periods of p75 LCP/INP/CLS). Uses the same free Google
 * API key as PageSpeed (CrUX API must be enabled). Degrades to
 * `available:false` when no key or the origin isn't in the CrUX dataset.
 */

const CRUX_HISTORY_URL = "https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord";

export interface CwvPoint {
  date: string;
  lcpMs?: number;
  inpMs?: number;
  cls?: number;
}

export function getCruxKey(): string | null {
  const k = process.env.CRUX_API_KEY || process.env.PAGESPEED_API_KEY;
  return k && k.trim() && !k.startsWith("your-") ? k.trim() : null;
}

export function hasCruxHistoryCapability(): boolean {
  return getCruxKey() != null;
}

interface CruxTimeseriesMetric {
  percentilesTimeseries?: { p75s?: Array<number | null> };
}
interface CruxHistoryResponse {
  record?: {
    metrics?: {
      largest_contentful_paint?: CruxTimeseriesMetric;
      interaction_to_next_paint?: CruxTimeseriesMetric;
      cumulative_layout_shift?: CruxTimeseriesMetric;
    };
    collectionPeriods?: Array<{ lastDate?: { year: number; month: number; day: number } }>;
  };
}

export async function getCruxHistory(
  domain: string
): Promise<{ available: boolean; reason?: string; points: CwvPoint[] }> {
  const key = getCruxKey();
  if (!key) return { available: false, reason: "No CrUX/PageSpeed API key set (free).", points: [] };

  const origin = `https://${domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]}`;
  try {
    const res = await fetchWithTimeout(`${CRUX_HISTORY_URL}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origin,
        metrics: ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift"],
      }),
      timeoutMs: 20_000,
    });
    if (res.status === 404) {
      return { available: false, reason: "Origin not in the CrUX dataset (insufficient traffic).", points: [] };
    }
    if (!res.ok) return { available: false, reason: `CrUX History ${res.status}`, points: [] };

    const data = (await res.json()) as CruxHistoryResponse;
    const periods = data.record?.collectionPeriods || [];
    const lcp = data.record?.metrics?.largest_contentful_paint?.percentilesTimeseries?.p75s || [];
    const inp = data.record?.metrics?.interaction_to_next_paint?.percentilesTimeseries?.p75s || [];
    const cls = data.record?.metrics?.cumulative_layout_shift?.percentilesTimeseries?.p75s || [];

    const points: CwvPoint[] = periods.map((p, i) => {
      const d = p.lastDate;
      const date = d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : `t${i}`;
      return {
        date,
        lcpMs: numOrUndef(lcp[i]),
        inpMs: numOrUndef(inp[i]),
        cls: clsOrUndef(cls[i]),
      };
    });

    return { available: true, points };
  } catch (error) {
    logProviderError("crux-history", error, { origin });
    return { available: false, reason: error instanceof Error ? error.message : "CrUX History failed", points: [] };
  }
}

function numOrUndef(v: number | null | undefined): number | undefined {
  return typeof v === "number" ? Math.round(v) : undefined;
}
function clsOrUndef(v: number | null | undefined): number | undefined {
  return typeof v === "number" ? Number(v.toFixed(3)) : undefined;
}
