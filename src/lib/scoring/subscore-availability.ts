import type { OmniPresenceScore } from "@/types/database";

/** The exact dimension keys calculateOmniPresenceScore() (omnipresence.ts WEIGHTS) computes availability for. */
export type SubScoreDimensionKey =
  | "ai_visibility"
  | "search_visibility"
  | "local_visibility"
  | "social_presence"
  | "directory_coverage"
  | "authority_mentions"
  | "technical_readiness"
  | "conversion_readiness";

/** All dimension keys, in a stable order — the single source of truth for "how many dimensions exist". */
export const SCORE_DIMENSION_KEYS: SubScoreDimensionKey[] = [
  "ai_visibility",
  "search_visibility",
  "local_visibility",
  "social_presence",
  "directory_coverage",
  "authority_mentions",
  "technical_readiness",
  "conversion_readiness",
];

/**
 * P0 fix: calculateOmniPresenceScore() computes, per dimension, whether we
 * genuinely measured anything (breakdown.dimension_availability) — an
 * unmeasured dimension's raw numeric column (local_visibility,
 * social_presence, etc.) is a real `0` in the DB, indistinguishable from an
 * actually-measured zero. The overall omnipresence_score already
 * re-normalizes over only available dimensions, but report subScore
 * displays (standard HTML report, deep intelligence report, React-PDF
 * document) were all reading the raw per-dimension columns directly with no
 * such gate — a project with no GBP/social/directory data connected
 * rendered "Local: 0/100", "Social: 0/100", "Directories: 0/100" as if we'd
 * checked and found nothing, instead of "no data yet". Renderers must treat
 * a `false` return here as "omit or label as no data", never as a numeric
 * zero.
 *
 * scores rows persisted before dimension_availability existed have no
 * breakdown.dimension_availability at all — those default to available (the
 * pre-existing behavior) rather than retroactively hiding old reports.
 */
export function isSubScoreAvailable(score: OmniPresenceScore, dimensionKey: SubScoreDimensionKey): boolean {
  const availability = (score.breakdown as { dimension_availability?: Record<string, boolean> } | undefined)
    ?.dimension_availability;
  if (!availability) return true;
  return Boolean(availability[dimensionKey]);
}

/** Batch form: label -> dimension key, returns label -> available. */
export function getSubScoreAvailability(
  score: OmniPresenceScore,
  labelToKey: Record<string, SubScoreDimensionKey>
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [label, key] of Object.entries(labelToKey)) {
    out[label] = isSubScoreAvailable(score, key);
  }
  return out;
}
