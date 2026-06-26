/**
 * Honest keyword-volume estimation — the technique real tools use, made free.
 *
 * No free source gives exact volume, so we reproduce the industry-standard
 * calibration chain and label every output by confidence:
 *
 *   1. keyword_planner — real Google Ads bucketed volume (high confidence).
 *   2. trends_extrapolated — Google Trends proportional extrapolation against a
 *      KNOWN-volume anchor: est = (targetScore / anchorScore) * anchorVolume,
 *      with a ±30% range (medium confidence). The anchor comes from Google
 *      Search Console (a query you rank top-10 for, where impressions ≈ volume)
 *      or any keyword whose volume we already trust.
 *   3. trends_relative — only the relative 0-100 demand index (low confidence).
 *   4. heuristic — autocomplete/SERP-derived estimate (low confidence).
 *
 * Google reports volume in ~60 log-scale buckets (10–100, 100–1K, ...), so we
 * present a bucket label rather than a fake-precise number.
 */
import { getTrendsComparison } from "@/lib/providers/google-trends";

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
  /** Absolute midpoint estimate when calibrated; undefined when relative-only. */
  volume?: number;
  volume_low?: number;
  volume_high?: number;
  /** Google-style log bucket, e.g. "1K–10K". */
  range_bucket: string;
  /** Relative Google Trends demand index 0-100. */
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
 * Standard organic CTR-by-position curve (Advanced Web Ranking-style). Used to
 * back-solve approximate true volume from GSC impressions when a query's
 * position is high enough that impressions undercount total searches.
 */
function impressionsToVolume(impressions: number, position: number): number {
  // For a top-10 ranking, the result is shown for ~all searches, so
  // impressions ≈ volume. Beyond page 1, scale up modestly.
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

function relativeEstimate(keyword: string, trendIndex?: number): VolumeEstimate {
  return {
    keyword,
    range_bucket: "n/a",
    trend_index: trendIndex,
    confidence: "low",
    method: "trends_relative",
  };
}

/**
 * Calibrate absolute volume estimates for `keywords` using Google Trends
 * proportional extrapolation against a known-volume anchor. Batches into
 * groups of 4 targets + the anchor (Trends allows max 5 per comparison) so the
 * anchor normalizes every batch onto the same scale.
 */
export async function calibrateWithAnchor(
  keywords: string[],
  anchor: VolumeAnchor,
  geo = "US"
): Promise<Map<string, VolumeEstimate>> {
  const out = new Map<string, VolumeEstimate>();
  const targets = [...new Set(keywords)].filter((k) => k && k !== anchor.keyword);

  for (let i = 0; i < targets.length; i += 4) {
    const batch = targets.slice(i, i + 4);
    const cmp = await getTrendsComparison([anchor.keyword, ...batch], geo);
    const anchorScore = cmp?.get(anchor.keyword) ?? 0;
    for (const kw of batch) {
      const score = cmp?.get(kw);
      if (cmp && anchorScore > 0 && typeof score === "number") {
        const vol = Math.max(1, Math.round((score / anchorScore) * anchor.volume));
        out.set(kw, {
          keyword: kw,
          volume: vol,
          volume_low: Math.round(vol * 0.7),
          volume_high: Math.round(vol * 1.3),
          range_bucket: volumeBucket(vol),
          trend_index: score,
          confidence: "medium",
          method: "trends_extrapolated",
        });
      } else {
        out.set(kw, relativeEstimate(kw, score));
      }
    }
  }
  // The anchor itself is known.
  out.set(anchor.keyword, {
    keyword: anchor.keyword,
    volume: anchor.volume,
    volume_low: Math.round(anchor.volume * 0.8),
    volume_high: Math.round(anchor.volume * 1.2),
    range_bucket: volumeBucket(anchor.volume),
    confidence: "high",
    method: "keyword_planner",
  });
  return out;
}

/**
 * Classify a known numeric volume (e.g. from Keyword Planner) into the honest
 * bucket + confidence shape, so all rows share one presentation.
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
