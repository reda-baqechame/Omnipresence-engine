/**
 * Pure, dependency-free keyword-volume math (no IO, no `@/` imports) so it can
 * be unit-tested directly and reused by the live estimator in keyword-volume.ts.
 *
 * Google reports volume in ~log-scale buckets, and no free source gives exact
 * volume, so the honest output is a bucket + a calibrated midpoint with a range.
 * Keeping this math separate from the Trends/GSC IO is what lets the golden
 * accuracy audit assert it against known volume bands without a network call.
 */

export type VolumeConfidence = "low" | "medium" | "high";
export type VolumeMethod =
  | "keyword_planner"
  | "trends_extrapolated"
  | "trends_relative"
  | "heuristic";

export interface VolumeAnchor {
  keyword: string;
  /** Approx monthly searches we trust (GSC impressions for a top-10 query, or KP volume). */
  volume: number;
}

export interface VolumeEstimate {
  keyword: string;
  volume?: number;
  volume_low?: number;
  volume_high?: number;
  range_bucket: string;
  trend_index?: number;
  confidence: VolumeConfidence;
  method: VolumeMethod;
}

const BUCKETS: Array<[number, string]> = [
  [100, "10–100"],
  [1000, "100–1K"],
  [10000, "1K–10K"],
  [100000, "10K–100K"],
  [1000000, "100K–1M"],
  [Infinity, "1M+"],
];

export function volumeBucket(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "n/a";
  for (const [ceil, label] of BUCKETS) if (n < ceil) return label;
  return "1M+";
}

/**
 * Standard organic CTR-by-position curve. Back-solves approximate true volume
 * from GSC impressions: a top-10 ranking is shown for ~all searches
 * (impressions ≈ volume); beyond page 1 we scale up modestly.
 */
export function impressionsToVolume(impressions: number, position: number): number {
  if (position <= 10) return impressions;
  if (position <= 20) return Math.round(impressions * 1.4);
  return Math.round(impressions * 2);
}

/** Build a trustworthy volume anchor from GSC rows (best top-ranked query). */
export function deriveGscAnchor(
  rows: Array<{ query: string; impressions: number; position: number }>
): VolumeAnchor | null {
  const candidates = rows
    .filter((r) => r.query.length > 2 && r.position <= 10 && r.impressions >= 50)
    .sort((a, b) => b.impressions - a.impressions);
  const best = candidates[0];
  if (!best) return null;
  return { keyword: best.query, volume: impressionsToVolume(best.impressions, best.position) };
}

export function relativeEstimate(keyword: string, trendIndex?: number): VolumeEstimate {
  return {
    keyword,
    range_bucket: "n/a",
    trend_index: trendIndex,
    confidence: "low",
    method: "trends_relative",
  };
}

/**
 * Proportional Trends extrapolation against a known-volume anchor:
 * est = (targetScore / anchorScore) * anchorVolume, with a ±30% range.
 * Returns a relative-only estimate when the anchor score is unusable.
 */
export function extrapolateVolume(
  keyword: string,
  score: number | undefined,
  anchorScore: number,
  anchorVolume: number
): VolumeEstimate {
  if (anchorScore > 0 && typeof score === "number") {
    const vol = Math.max(1, Math.round((score / anchorScore) * anchorVolume));
    return {
      keyword,
      volume: vol,
      volume_low: Math.round(vol * 0.7),
      volume_high: Math.round(vol * 1.3),
      range_bucket: volumeBucket(vol),
      trend_index: score,
      confidence: "medium",
      method: "trends_extrapolated",
    };
  }
  return relativeEstimate(keyword, score);
}

/**
 * Classify a known numeric volume (e.g. from Keyword Planner) into the honest
 * bucket + confidence shape so all rows share one presentation.
 */
export function fromKnownVolume(
  keyword: string,
  volume: number,
  method: VolumeMethod = "keyword_planner"
): VolumeEstimate {
  const confidence: VolumeConfidence = method === "keyword_planner" ? "high" : "low";
  return {
    keyword,
    volume,
    volume_low: Math.round(volume * (confidence === "high" ? 0.8 : 0.6)),
    volume_high: Math.round(volume * (confidence === "high" ? 1.2 : 1.6)),
    range_bucket: volumeBucket(volume),
    confidence,
    method,
  };
}
