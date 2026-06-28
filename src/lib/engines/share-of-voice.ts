import type { VisibilityResult } from "@/types/database";
import { resultDataQuality, isCountableVisibility } from "@/lib/engines/provenance";
import type { EntityProminence } from "@/lib/engines/visibility-scanner";

/**
 * Prominence-weighted Share of Voice — the methodology analyst tools
 * (Profound / Peec / Otterly) use to beat naive "count the mentions" SoV.
 *
 * A raw mention count treats "Acme is the #1 choice" identically to "...or, in a
 * pinch, Acme." That's wrong: AI buyers act on the FIRST, STRONGEST
 * recommendation. So each mention is weighted by:
 *   weight = recommendationStrength × positionWeight(answerPosition)
 * where strength is 1 for a strong recommendation and 0.5 for a passing mention,
 * and positionWeight is reciprocal rank (1st = 1.0, 2nd = 0.5, 3rd ≈ 0.33) so
 * being named first dominates being named last.
 *
 * Per-entity prominence is computed at scan time (`computeEntityProminence`) and
 * stored in raw_response.entity_prominence. For older rows / SERP rows without
 * it we fall back to the brand's stored prominence columns and a neutral weight
 * for competitors — never fabricating, just degrading gracefully.
 */

export interface SovEntry {
  name: string;
  isBrand: boolean;
  /** Number of measured answers this entity appeared in. */
  appearances: number;
  /** Prominence-weighted score (sum of per-answer weights). */
  weightedScore: number;
  /** Share of the total weighted score across all entities (0-1). */
  shareOfVoice: number;
  /** Mean ordinal answer position when named (lower = better), null if unknown. */
  avgPosition: number | null;
  /** Mean recommendation strength when named (0-1). */
  avgStrength: number;
}

export interface ShareOfVoiceResult {
  /** Leaderboard sorted by shareOfVoice desc (brand + every competitor that appeared). */
  leaderboard: SovEntry[];
  /** The brand's own entry, or null if the brand never appeared in a measured answer. */
  brand: SovEntry | null;
  /** The brand's rank on the leaderboard (1 = leader), null if it never appeared. */
  brandRank: number | null;
  /** Number of measured probes the leaderboard is built from. */
  sampleSize: number;
}

/** Reciprocal-rank position weight. position 1 -> 1.0, 2 -> 0.5, 3 -> 0.33. */
function positionWeight(position: number | null): number {
  if (!position || position < 1) return 0.6; // unknown position: neutral mid weight
  return 1 / position;
}

function readEntityProminence(
  raw: Record<string, unknown> | null | undefined
): Record<string, EntityProminence> {
  const ep = raw?.entity_prominence;
  if (ep && typeof ep === "object") return ep as Record<string, EntityProminence>;
  return {};
}

export function calculateShareOfVoice(
  results: VisibilityResult[],
  brandName: string,
  competitors: string[]
): ShareOfVoiceResult {
  const pool = results.filter((r) => isCountableVisibility(resultDataQuality(r)));

  type Acc = { appearances: number; weighted: number; positions: number[]; strengths: number[] };
  const acc = new Map<string, { isBrand: boolean; a: Acc }>();
  const ensure = (name: string, isBrand: boolean) => {
    let e = acc.get(name);
    if (!e) {
      e = { isBrand, a: { appearances: 0, weighted: 0, positions: [], strengths: [] } };
      acc.set(name, e);
    }
    return e;
  };

  const add = (name: string, isBrand: boolean, strength: number, position: number | null) => {
    const e = ensure(name, isBrand);
    e.a.appearances++;
    e.a.weighted += strength * positionWeight(position);
    if (typeof position === "number" && position > 0) e.a.positions.push(position);
    e.a.strengths.push(strength);
  };

  for (const r of pool) {
    const prom = readEntityProminence(r.raw_response as Record<string, unknown> | null | undefined);

    // Brand: prefer the stored per-entity prominence, then the dedicated columns,
    // then the boolean mention as a last resort.
    if (prom[brandName]) {
      add(brandName, true, prom[brandName].strength, prom[brandName].position);
    } else if (r.brand_mentioned) {
      add(brandName, true, r.recommendation_strength ?? 0.5, r.answer_position ?? null);
    }

    // Competitors: stored prominence when available, else the boolean mention
    // with a neutral strength so a measured competitor mention still counts.
    const compMentions = r.competitor_mentions || {};
    for (const comp of competitors) {
      if (prom[comp]) {
        add(comp, false, prom[comp].strength, prom[comp].position);
      } else if (compMentions[comp]) {
        add(comp, false, 0.5, null);
      }
    }
  }

  const totalWeighted = [...acc.values()].reduce((s, e) => s + e.a.weighted, 0) || 1;

  const leaderboard: SovEntry[] = [...acc.entries()]
    .map(([name, { isBrand, a }]) => ({
      name,
      isBrand,
      appearances: a.appearances,
      weightedScore: Math.round(a.weighted * 1000) / 1000,
      shareOfVoice: Math.round((a.weighted / totalWeighted) * 1000) / 1000,
      avgPosition: a.positions.length
        ? Math.round((a.positions.reduce((x, y) => x + y, 0) / a.positions.length) * 10) / 10
        : null,
      avgStrength: a.strengths.length
        ? Math.round((a.strengths.reduce((x, y) => x + y, 0) / a.strengths.length) * 100) / 100
        : 0,
    }))
    .sort((a, b) => b.shareOfVoice - a.shareOfVoice);

  const brandIdx = leaderboard.findIndex((e) => e.isBrand);

  return {
    leaderboard,
    brand: brandIdx >= 0 ? leaderboard[brandIdx] : null,
    brandRank: brandIdx >= 0 ? brandIdx + 1 : null,
    sampleSize: pool.length,
  };
}

export interface SovByEngine {
  engine: string;
  sov: ShareOfVoiceResult;
}

/**
 * Per-engine Share of Voice — where you win (e.g. ChatGPT) vs lose (e.g.
 * Perplexity). The same prominence-weighted methodology, sliced by engine, so a
 * customer can target the specific surfaces where competitors out-rank them.
 * Only engines with at least one measured answer are returned.
 */
export function calculateShareOfVoiceByEngine(
  results: VisibilityResult[],
  brandName: string,
  competitors: string[]
): SovByEngine[] {
  const byEngine = new Map<string, VisibilityResult[]>();
  for (const r of results) {
    if (!byEngine.has(r.engine)) byEngine.set(r.engine, []);
    byEngine.get(r.engine)!.push(r);
  }
  return [...byEngine.entries()]
    .map(([engine, rows]) => ({ engine, sov: calculateShareOfVoice(rows, brandName, competitors) }))
    .filter((x) => x.sov.sampleSize > 0)
    .sort((a, b) => (b.sov.brand?.shareOfVoice ?? 0) - (a.sov.brand?.shareOfVoice ?? 0));
}

export interface SovTrendPoint {
  runId: string;
  /** ISO date of the run (completed_at or created_at). */
  date: string;
  /** Brand's prominence-weighted share of voice for that run (0-1). */
  shareOfVoice: number;
  /** Brand's rank on that run's leaderboard (1 = leader), null if absent. */
  rank: number | null;
  /** Total entities competing on that run (for context). */
  fieldSize: number;
  /** Measured probes in the run. */
  sampleSize: number;
}

/**
 * Share-of-Voice trend across completed runs (oldest → newest) — the retention
 * hook that shows the leaderboard MOVING as the platform does its work. Each
 * point is the brand's prominence-weighted SoV for one run.
 */
export function calculateSovTrend(
  runs: Array<{ runId: string; date: string; results: VisibilityResult[] }>,
  brandName: string,
  competitors: string[]
): SovTrendPoint[] {
  return runs
    .map(({ runId, date, results }) => {
      const sov = calculateShareOfVoice(results, brandName, competitors);
      return {
        runId,
        date,
        shareOfVoice: sov.brand?.shareOfVoice ?? 0,
        rank: sov.brandRank,
        fieldSize: sov.leaderboard.length,
        sampleSize: sov.sampleSize,
      };
    })
    .filter((p) => p.sampleSize > 0)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}
