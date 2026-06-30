/**
 * Fastest-path-to-visibility engine (Wave T2).
 *
 * A brand-new brand cannot win head-to-head on high-authority head terms on day
 * one. This engine ranks the surfaces a new brand CAN realistically win soonest
 * — long-tail content, local/GBP, comparison/alternative pages, low-competition
 * directories, Reddit/Quora answers, and AI-cited sources — by time-to-impact,
 * winnability, business impact, and effort, then emits an ordered "win this
 * first" plan. Pure + dependency-free so it is directly unit-testable.
 */

export type WinnableSurfaceType =
  | "long_tail_content"
  | "local_gbp"
  | "comparison_alternative"
  | "directory"
  | "reddit_quora"
  | "ai_cited_source"
  | "review_site"
  | "schema_markup";

export interface WinnableSurface {
  id: string;
  type: WinnableSurfaceType;
  title: string;
  /** Estimated days until this surface can move visibility. Lower = faster. */
  timeToImpactDays: number;
  effort: "low" | "medium" | "high";
  /** 0-1 likelihood a NEW brand can realistically win this surface. */
  winnability: number;
  /** 0-100 business impact if won. */
  impact: number;
  rationale: string;
  /** Recommended execution action type (maps to the ops/execution layer). */
  action: string;
}

export interface FastestPathItem extends WinnableSurface {
  /** 0-100 composite priority. */
  score: number;
  rank: number;
  /** Human-readable "why this first". */
  why: string;
}

export interface FastestPathOptions {
  /** Horizon for normalizing time-to-impact (days). Default 90. */
  horizonDays?: number;
  /** How many items to return. Default all. */
  limit?: number;
}

const EFFORT_SCORE: Record<WinnableSurface["effort"], number> = {
  low: 1,
  medium: 0.6,
  high: 0.3,
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Rank winnable surfaces by a composite that rewards speed + winnability +
 * impact and penalizes effort. Speed is weighted highest because the whole point
 * of the fastest-path is early, compounding wins that fund the harder ones.
 */
export function rankFastestPath(
  surfaces: WinnableSurface[],
  options: FastestPathOptions = {}
): FastestPathItem[] {
  const horizon = options.horizonDays ?? 90;

  const scored = surfaces.map((s) => {
    const speedScore = clamp01(1 - s.timeToImpactDays / horizon);
    const winScore = clamp01(s.winnability);
    const impactScore = clamp01(s.impact / 100);
    const effortScore = EFFORT_SCORE[s.effort];

    const composite =
      winScore * 0.3 + speedScore * 0.3 + impactScore * 0.3 + effortScore * 0.1;
    const score = Math.round(composite * 1000) / 10; // 0-100, 1 decimal

    return {
      ...s,
      score,
      rank: 0,
      why: `${Math.round(winScore * 100)}% winnable, ~${s.timeToImpactDays}d to impact, ${s.effort} effort, impact ${s.impact}.`,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.timeToImpactDays - b.timeToImpactDays);
  scored.forEach((s, i) => (s.rank = i + 1));

  return typeof options.limit === "number" ? scored.slice(0, options.limit) : scored;
}

export interface FastestPathContext {
  /** 0-100 domain authority (low = newer/weaker brand → more winnable long-tail). */
  domainAuthority?: number;
  /** Brand is local (has/needs a Google Business Profile). */
  isLocal?: boolean;
  hasGbp?: boolean;
  competitorCount?: number;
  /** Low-competition long-tail keywords (keyword + difficulty 0-100). */
  longTailKeywords?: Array<{ keyword: string; difficulty?: number; volume?: number }>;
  /** Directory/review/social surfaces the brand is NOT yet present on. */
  missingDirectories?: Array<{ name: string; surface: string }>;
  /** Source domains that cite competitors but not the brand. */
  citationGapDomains?: Array<{ domain: string; authority?: number }>;
}

/**
 * Derive concrete winnable-surface candidates from real project context. Keeps
 * the heuristics explicit so the plan is explainable and tunable.
 */
export function buildWinnableSurfaces(context: FastestPathContext): WinnableSurface[] {
  const surfaces: WinnableSurface[] = [];
  const authority = context.domainAuthority ?? 0;
  // Newer/weaker domains win long-tail faster; high authority shifts the
  // fastest path toward bigger surfaces sooner.
  const newBrand = authority < 40;

  // 1. Long-tail content — the canonical fastest win for a new brand.
  for (const kw of (context.longTailKeywords || []).slice(0, 10)) {
    const difficulty = kw.difficulty ?? 30;
    if (difficulty > 45) continue; // not winnable-soon for a new brand
    surfaces.push({
      id: `long_tail:${kw.keyword}`,
      type: "long_tail_content",
      title: `Publish an answer-first page for "${kw.keyword}"`,
      timeToImpactDays: difficulty < 25 ? 14 : 28,
      effort: "medium",
      winnability: clamp01(1 - difficulty / 100),
      impact: Math.min(70, 30 + Math.round((kw.volume ?? 0) / 50)),
      rationale: `Low difficulty (${difficulty}) long-tail term — winnable before head terms.`,
      action: "create_content",
    });
  }

  // 2. Local / GBP — fast, high-trust surface for local brands.
  if (context.isLocal || context.hasGbp === false) {
    surfaces.push({
      id: "local:gbp",
      type: "local_gbp",
      title: context.hasGbp ? "Optimize Google Business Profile" : "Claim & optimize Google Business Profile",
      timeToImpactDays: 10,
      effort: "low",
      winnability: 0.85,
      impact: 65,
      rationale: "Local pack + Maps are winnable fast and convert high-intent searches.",
      action: "gbp_post",
    });
  }

  // 3. Comparison / alternative pages — capture competitor-intent traffic.
  if ((context.competitorCount ?? 0) > 0) {
    surfaces.push({
      id: "comparison:alternatives",
      type: "comparison_alternative",
      title: "Publish \"alternative to <competitor>\" comparison pages",
      timeToImpactDays: 30,
      effort: "medium",
      winnability: 0.6,
      impact: 60,
      rationale: "Comparison/alternative intent is high-converting and under-defended by incumbents.",
      action: "alternative_page",
    });
  }

  // 4. Low-competition directories / review sites the brand is missing.
  for (const dir of (context.missingDirectories || []).slice(0, 8)) {
    const isReview = ["g2", "capterra", "trustpilot", "review_site"].includes(dir.surface);
    surfaces.push({
      id: `directory:${dir.surface}:${dir.name}`,
      type: isReview ? "review_site" : "directory",
      title: `Establish presence on ${dir.name}`,
      timeToImpactDays: isReview ? 21 : 7,
      effort: "low",
      winnability: 0.8,
      impact: isReview ? 45 : 35,
      rationale: isReview
        ? "Review sites are frequently cited by AI answers and rank fast for branded + category terms."
        : "Authoritative directory listing is a low-effort citation a new brand can win immediately.",
      action: "directory_submit",
    });
  }

  // 5. Reddit / Quora — community answers AI engines cite heavily.
  surfaces.push({
    id: "community:reddit_quora",
    type: "reddit_quora",
    title: "Answer high-intent Reddit/Quora threads in your category",
    timeToImpactDays: 14,
    effort: "low",
    winnability: 0.7,
    impact: 50,
    rationale: "Reddit/Quora are disproportionately cited by ChatGPT/Perplexity and rank quickly.",
    action: "outreach",
  });

  // 6. AI-cited source gaps — earn a mention where competitors are cited.
  for (const src of (context.citationGapDomains || []).slice(0, 6)) {
    const auth = src.authority ?? 50;
    surfaces.push({
      id: `ai_source:${src.domain}`,
      type: "ai_cited_source",
      title: `Earn a citation on ${src.domain}`,
      timeToImpactDays: auth > 70 ? 45 : 30,
      effort: auth > 70 ? "high" : "medium",
      winnability: clamp01(0.7 - auth / 200),
      impact: Math.min(75, 40 + Math.round(auth / 4)),
      rationale: `${src.domain} cites competitors but not you — winning it directly lifts AI visibility.`,
      action: "outreach",
    });
  }

  // 7. Schema markup — deterministic, instant retrieval-readiness for new brands.
  if (newBrand) {
    surfaces.push({
      id: "schema:core",
      type: "schema_markup",
      title: "Deploy Organization + FAQ + Product schema",
      timeToImpactDays: 5,
      effort: "low",
      winnability: 0.95,
      impact: 40,
      rationale: "Deterministic, fully in our control, and makes pages eligible for AI/rich results fast.",
      action: "schema_deploy",
    });
  }

  return surfaces;
}

/**
 * One-call helper: derive candidates from context and return the ranked plan.
 */
export function computeFastestPath(
  context: FastestPathContext,
  options: FastestPathOptions = {}
): FastestPathItem[] {
  return rankFastestPath(buildWinnableSurfaces(context), options);
}
