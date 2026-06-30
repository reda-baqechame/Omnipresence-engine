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
import {
  volumeBucket,
  extrapolateVolume,
  type VolumeAnchor,
  type VolumeEstimate,
} from "@/lib/engines/keyword-volume-math";

export {
  volumeBucket,
  impressionsToVolume,
  deriveGscAnchor,
  fromKnownVolume,
  extrapolateVolume,
} from "@/lib/engines/keyword-volume-math";
export type {
  VolumeConfidence,
  VolumeMethod,
  VolumeAnchor,
  VolumeEstimate,
} from "@/lib/engines/keyword-volume-math";

/**
 * Calibrate absolute volume estimates for `keywords` using Google Trends
 * proportional extrapolation against a known-volume anchor. Batches into
 * groups of 4 targets + the anchor (Trends allows max 5 per comparison) so the
 * anchor normalizes every batch onto the same scale. The per-keyword math lives
 * in keyword-volume-math.ts (extrapolateVolume) so it is independently audited.
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
      out.set(kw, extrapolateVolume(kw, cmp?.get(kw), anchorScore, anchor.volume));
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
