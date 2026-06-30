/**
 * Impact estimate model (Wave Q4).
 *
 * Every completed action should carry a projected business impact so the proof
 * chain answers "what is this worth?" — not just "did it run?". Estimates are
 * deliberately conservative and clearly labeled as projections (not measured
 * results); the real measured lift comes later from the deploy→rescan loop.
 */

export type ImpactActionType =
  | "content_publish"
  | "content_published"
  | "cms_patch"
  | "schema_deploy"
  | "indexnow"
  | "urls_indexed"
  | "gbp_post"
  | "social_post"
  | "social_scheduled"
  | "source_opportunity"
  | "generic";

export interface ImpactInputs {
  actionType: string;
  /** 0-100 source/opportunity influence when known. */
  influence?: number;
  /** Monthly search volume for the targeted keyword when known. */
  keywordVolume?: number;
  /** Average CPC (USD) for the keyword cluster when known. */
  cpc?: number;
  /** 0-100 difficulty (higher = harder, dampens projected impact). */
  difficulty?: number;
}

export interface ImpactEstimate {
  projected_citation_lift_pp: number;
  projected_monthly_clicks: number;
  projected_value_usd: number;
  confidence: "low" | "medium" | "high";
  basis: string;
  is_projection: true;
}

// Baseline citation-lift potential per action type (percentage points), before
// damping by difficulty. Grounded in the relative leverage each surface has.
const BASE_LIFT_PP: Record<string, number> = {
  content_publish: 4,
  content_published: 4,
  cms_patch: 3,
  schema_deploy: 2,
  source_opportunity: 6,
  gbp_post: 1.5,
  social_post: 1,
  social_scheduled: 1,
  indexnow: 0.5,
  urls_indexed: 0.5,
  generic: 1,
};

// Assumed organic CTR uplift when a page starts ranking/being cited for a term.
const ASSUMED_CTR = 0.18;
const DEFAULT_CPC = 2.5;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function estimateActionImpact(inputs: ImpactInputs): ImpactEstimate {
  const base = BASE_LIFT_PP[inputs.actionType] ?? BASE_LIFT_PP.generic;
  const influenceFactor = inputs.influence != null ? 0.5 + (clamp(inputs.influence, 0, 100) / 100) : 1;
  const difficultyDamp = inputs.difficulty != null ? 1 - clamp(inputs.difficulty, 0, 100) / 200 : 1;

  const citationLiftPp = Math.round(base * influenceFactor * difficultyDamp * 10) / 10;

  const volume = inputs.keywordVolume ?? 0;
  // Clicks projected from the share of the keyword's monthly volume we might win.
  const projectedMonthlyClicks = Math.round(volume * (citationLiftPp / 100) * ASSUMED_CTR);

  const cpc = inputs.cpc ?? DEFAULT_CPC;
  const projectedValueUsd = Math.round(projectedMonthlyClicks * cpc);

  // Confidence rises with how much real signal we had to estimate from.
  const signals = [inputs.influence != null, inputs.keywordVolume != null, inputs.cpc != null].filter(Boolean).length;
  const confidence = signals >= 2 ? "high" : signals === 1 ? "medium" : "low";

  const basis =
    volume > 0
      ? `${citationLiftPp}pp projected citation lift × ${volume}/mo volume × ${Math.round(ASSUMED_CTR * 100)}% CTR × $${cpc} CPC`
      : `${citationLiftPp}pp projected citation lift (no volume data — value not modeled)`;

  return {
    projected_citation_lift_pp: citationLiftPp,
    projected_monthly_clicks: projectedMonthlyClicks,
    projected_value_usd: projectedValueUsd,
    confidence,
    basis,
    is_projection: true,
  };
}
