/**
 * Pure rank-tracking math — extracted from rank-tracker-service so the decision
 * logic that drives client-facing rankings (share-of-voice, striking-distance,
 * rank-drop alerts) is unit-testable in isolation, with zero DB/provider deps.
 *
 * Every function here is deterministic and side-effect free. Behavior is pinned
 * by rank-math.test.ts: getting these wrong means wrong alerts / wrong SoV, which
 * is exactly the kind of "data not delivering" failure that triggers refunds.
 */

/**
 * Approximate organic click-through rate by SERP position. Used only to weight
 * share-of-voice — NOT presented as a measured CTR. Positions outside the curve
 * (null, 0, >20) contribute no clicks.
 */
export function ctrByPosition(position: number | null): number {
  if (position == null || position <= 0) return 0;
  if (position <= 1) return 0.28;
  if (position <= 2) return 0.15;
  if (position <= 3) return 0.1;
  if (position <= 5) return 0.06;
  if (position <= 10) return 0.025;
  if (position <= 20) return 0.008;
  return 0;
}

/**
 * CTR-weighted share of voice for our domain against competitor positions on the
 * same SERP. Returns a 0..1 fraction rounded to 3 decimals, or 0 when nobody on
 * the considered set has any click weight (never NaN).
 */
export function shareOfVoiceFromPositions(
  ourPosition: number | null,
  competitorPositions: Array<number | null>
): number {
  const ourCtr = ctrByPosition(ourPosition);
  const compCtr = competitorPositions.reduce<number>((sum, p) => sum + ctrByPosition(p), 0);
  const denom = ourCtr + compCtr;
  if (denom <= 0) return 0;
  return Math.round((ourCtr / denom) * 1000) / 1000;
}

/**
 * "Striking distance" = ranking on page 2-3 (positions 4-20): close enough that
 * a focused push can realistically move it onto page 1. Position 1-3 is already
 * winning; >20 is too far to call striking distance.
 */
export function isStrikingDistance(position: number | null): boolean {
  return position != null && position > 3 && position <= 20;
}

export interface RankChange {
  /** Was on page 1 and is now off it (or lost entirely). */
  droppedOffPage1: boolean;
  /** Dropped 5+ positions (got numerically worse). */
  bigDrop: boolean;
  /** Was ranking and now has no position at all. */
  lostRanking: boolean;
  /** Any of the above — i.e. an alert should fire. */
  isAlert: boolean;
  /** Signed change (positive = worse), or null when not comparable. */
  delta: number | null;
}

/**
 * Classify a position change against the previous measured position. Mirrors the
 * exact alert thresholds used by the rank tracker so the persisted alert and the
 * returned summary can never diverge.
 */
export function classifyRankChange(
  previousPosition: number | null,
  position: number | null
): RankChange {
  const droppedOffPage1 =
    previousPosition != null && previousPosition <= 10 && (position == null || position > 10);
  const bigDrop =
    previousPosition != null && position != null && position - previousPosition >= 5;
  const lostRanking = previousPosition != null && position == null;
  const delta =
    position != null && previousPosition != null ? position - previousPosition : null;
  return {
    droppedOffPage1,
    bigDrop,
    lostRanking,
    isAlert: droppedOffPage1 || bigDrop || lostRanking,
    delta,
  };
}
