/**
 * Minimum-gate PresenceOS Score (Wave T1).
 *
 * The composite is the MINIMUM across the critical gates — not a weighted
 * average. A closed-loop "prove real results" product is only as strong as its
 * weakest critical capability: a perfect measurement layer is worthless if
 * execution never ships, and flawless execution is unprovable without
 * attribution. Taking the minimum makes the score honest and impossible to game
 * by over-investing in one dimension, and it tells you exactly what to fix next.
 *
 * Pure + dependency-free so it is directly unit-testable and reused by the
 * guarantee/marketing-copy gates.
 */

export const CRITICAL_GATES = [
  "provenance",
  "evidence",
  "measurement",
  "ai_capture",
  "keyword",
  "rank",
  "backlink",
  "technical",
  "source_graph",
  "execution",
  "attribution",
  "production",
  "refund_safety",
] as const;

export type GateName = (typeof CRITICAL_GATES)[number];

export interface GateScore {
  gate: GateName;
  /** 0-100 readiness for this gate. */
  score: number;
  /** Whether we could actually evaluate this gate this run. */
  available: boolean;
  detail?: string;
}

export interface MinGateResult {
  /** Strict minimum-gate score: unavailable gates count as 0 (weakest link). */
  score: number;
  /** Minimum across the gates we COULD evaluate (for partial-coverage context). */
  availableScore: number;
  /** The gate dragging the composite down (lowest strict score). */
  limitingGate: GateName | null;
  gates: GateScore[];
  /** Fraction of critical gates that were evaluable (0-1). */
  coverage: number;
  /** All gates evaluable AND strict score ≥ readyThreshold. */
  ready: boolean;
  /** Same as `ready` — outcome guarantee/marketing superlatives require it. */
  guaranteeEligible: boolean;
}

export interface MinGateOptions {
  /** Strict score required for the platform to be "ready" (default 60). */
  readyThreshold?: number;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n * 100) / 100));

/** Build a gate from a 0-1 rate. */
export function gateFromRate(gate: GateName, rate: number, available = true, detail?: string): GateScore {
  return { gate, score: clamp(rate * 100), available, detail };
}

/** Build a gate from a boolean (met = full, else 0). */
export function gateFromBool(gate: GateName, met: boolean, available = true, detail?: string): GateScore {
  return { gate, score: met ? 100 : 0, available, detail };
}

/**
 * Compute the minimum-gate composite. The strict score treats unavailable gates
 * as 0 (you cannot prove what you cannot measure); `availableScore` exposes the
 * minimum across evaluable gates so the UI can explain partial coverage.
 */
export function computeMinGateScore(gates: GateScore[], options: MinGateOptions = {}): MinGateResult {
  const readyThreshold = options.readyThreshold ?? 60;

  // Index by gate name; missing gates are treated as unavailable/0.
  const byName = new Map<GateName, GateScore>();
  for (const g of gates) byName.set(g.gate, { ...g, score: clamp(g.score) });

  const full: GateScore[] = CRITICAL_GATES.map(
    (name) => byName.get(name) ?? { gate: name, score: 0, available: false, detail: "not evaluated" }
  );

  const evaluable = full.filter((g) => g.available);
  const coverage = Math.round((evaluable.length / CRITICAL_GATES.length) * 100) / 100;

  // Strict: unavailable => 0.
  const strictScores = full.map((g) => (g.available ? g.score : 0));
  const score = strictScores.length ? Math.min(...strictScores) : 0;
  const availableScore = evaluable.length ? Math.min(...evaluable.map((g) => g.score)) : 0;

  // Limiting gate = lowest strict score (ties resolved by gate order).
  let limitingGate: GateName | null = null;
  let lowest = Infinity;
  for (const g of full) {
    const strict = g.available ? g.score : 0;
    if (strict < lowest) {
      lowest = strict;
      limitingGate = g.gate;
    }
  }

  const ready = evaluable.length === CRITICAL_GATES.length && score >= readyThreshold;

  return {
    score,
    availableScore,
    limitingGate,
    gates: full,
    coverage,
    ready,
    guaranteeEligible: ready,
  };
}

export function getGateLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Proven", color: "text-green-500" };
  if (score >= 60) return { label: "Ready", color: "text-emerald-500" };
  if (score >= 40) return { label: "Partial", color: "text-yellow-500" };
  if (score >= 20) return { label: "Early", color: "text-orange-500" };
  return { label: "Unproven", color: "text-red-500" };
}
