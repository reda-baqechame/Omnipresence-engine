/**
 * Pure, dependency-free keyword-difficulty math (no IO, no `@/` imports).
 *
 * Real KD is a function of how strong the pages that already rank are. We model
 * it from the resolved authority of the ranking domains (+ SERP features), and
 * keep the formula here so it can be audited for monotonicity ("a SERP stacked
 * with higher-authority domains must score harder") without a live SERP call.
 */

export type DifficultyMethod = "ranking_authority" | "heuristic";

/** Classify search intent from the query text alone (deterministic). */
export function classifyIntent(keyword: string): string {
  const k = keyword.toLowerCase();
  if (/\b(near me|in [a-z]+|local)\b/.test(k)) return "local";
  if (/\b(buy|price|cost|quote|hire|book|order|pricing)\b/.test(k)) return "transactional";
  if (/\b(best|top|vs|compare|comparison|review|alternative)\b/.test(k)) return "commercial";
  return "informational";
}

/**
 * KD 1-100 from the ranking SERP's authority profile. Dominated by the average
 * authority of ranking domains, with bumps for many high-authority pages and an
 * AI Overview (harder to displace).
 */
export function computeDifficulty(avgAuth: number, highCount: number, hasAi: boolean): number {
  return Math.max(1, Math.min(100, Math.round(avgAuth * 0.85 + highCount * 3 + (hasAi ? 6 : 0))));
}

/**
 * Opportunity 0-100: easier keywords, striking-distance positions, and gaps win.
 */
export function computeOpportunity(
  difficulty: number,
  ourPosition: number | null,
  hasAi: boolean
): number {
  const lowDiffBonus = Math.max(0, 60 - difficulty);
  const strikingBonus = ourPosition && ourPosition >= 4 && ourPosition <= 20 ? 25 : 0;
  const notRankingBonus = ourPosition ? 0 : 15;
  return Math.min(100, lowDiffBonus + strikingBonus + notRankingBonus + (hasAi ? 10 : 0));
}

/** Method label: only claim the strong method when the SERP was mostly resolved. */
export function difficultyMethod(coverage: number, resolvedCount: number): DifficultyMethod {
  return coverage >= 0.5 && resolvedCount >= 3 ? "ranking_authority" : "heuristic";
}
