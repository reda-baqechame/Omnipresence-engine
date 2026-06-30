/**
 * Accuracy scoring helpers for the golden-dataset verification gate.
 *
 * These are pure, dependency-free functions (so they run under `node --test`
 * strip-only mode) used by every `*.accuracy.test.ts` to turn "sovereign output
 * vs known-true value" into hard pass/fail numbers: set precision/recall/F1 for
 * membership tasks (backlinks, SERP domains), MAE / percentage error for numeric
 * tasks (volume, CWV), Spearman rank correlation for ordering tasks (authority,
 * difficulty), and a monotonicity check for "more-is-bigger" guarantees.
 *
 * The doctrine: an accuracy claim must be MEASURED against ground truth, not
 * asserted. If the sovereign path can't clear the floor, the test fails and the
 * underlying engine gets fixed — never the threshold lowered to pass.
 */

/** Lowercase, strip scheme/path/www so domain comparisons are apples-to-apples. */
export function normalizeDomain(input: string): string {
  let s = (input || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("/")[0];
  s = s.split("?")[0];
  s = s.split("#")[0];
  return s.replace(/\.$/, "");
}

export interface SetScore {
  precision: number;
  recall: number;
  f1: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

/**
 * Precision/recall/F1 for a membership task. `predicted` and `expected` are
 * compared as sets after a normalizer (domains by default). Recall = "did we
 * find the known-true items"; precision = "were the items we returned real".
 */
export function setScore(
  predicted: string[],
  expected: string[],
  normalize: (s: string) => string = normalizeDomain
): SetScore {
  const pred = new Set(predicted.map(normalize).filter(Boolean));
  const exp = new Set(expected.map(normalize).filter(Boolean));
  let truePositives = 0;
  for (const e of exp) if (pred.has(e)) truePositives += 1;
  const falseNegatives = exp.size - truePositives;
  const falsePositives = pred.size - truePositives;
  const precision = pred.size === 0 ? (exp.size === 0 ? 1 : 0) : truePositives / pred.size;
  const recall = exp.size === 0 ? 1 : truePositives / exp.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, truePositives, falsePositives, falseNegatives };
}

/** Mean absolute error over paired numeric observations. */
export function meanAbsoluteError(pairs: Array<{ predicted: number; expected: number }>): number {
  if (pairs.length === 0) return 0;
  const sum = pairs.reduce((a, p) => a + Math.abs(p.predicted - p.expected), 0);
  return sum / pairs.length;
}

/** Mean absolute PERCENTAGE error (0..1+), guarding divide-by-zero. */
export function meanAbsolutePercentageError(
  pairs: Array<{ predicted: number; expected: number }>
): number {
  const usable = pairs.filter((p) => p.expected !== 0);
  if (usable.length === 0) return 0;
  const sum = usable.reduce((a, p) => a + Math.abs(p.predicted - p.expected) / Math.abs(p.expected), 0);
  return sum / usable.length;
}

/** True when `value` is within `tolerancePct` (0..1) of `expected`. */
export function withinTolerance(value: number, expected: number, tolerancePct: number): boolean {
  if (expected === 0) return Math.abs(value) <= tolerancePct;
  return Math.abs(value - expected) / Math.abs(expected) <= tolerancePct;
}

/**
 * Spearman rank correlation (-1..1) between two equally-ordered numeric series.
 * Used for "does our ordering match the known ordering" (authority, difficulty).
 * Returns 1 for identical ordering, -1 for reversed.
 */
export function spearmanRankCorrelation(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length < 2) return 0;
  const rank = (xs: number[]): number[] => {
    const indexed = xs.map((v, i) => ({ v, i }));
    indexed.sort((x, y) => x.v - y.v);
    const ranks = new Array<number>(xs.length);
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j += 1;
      const avgRank = (i + j) / 2 + 1; // average rank for ties (1-based)
      for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
      i = j + 1;
    }
    return ranks;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    va += (ra[i] - ma) ** 2;
    vb += (rb[i] - mb) ** 2;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}

/**
 * Count of adjacent out-of-order pairs in a series that SHOULD be monotonically
 * non-increasing (e.g. authority by descending known rank). 0 = perfectly ordered.
 */
export function monotonicViolations(series: number[], direction: "asc" | "desc" = "desc"): number {
  let violations = 0;
  for (let i = 1; i < series.length; i++) {
    if (direction === "desc" && series[i] > series[i - 1]) violations += 1;
    if (direction === "asc" && series[i] < series[i - 1]) violations += 1;
  }
  return violations;
}

/** Top-K membership: is `target` within the first K of `ranked` (normalized)? */
export function inTopK(
  ranked: string[],
  target: string,
  k: number,
  normalize: (s: string) => string = normalizeDomain
): boolean {
  const t = normalize(target);
  return ranked.slice(0, k).map(normalize).includes(t);
}
