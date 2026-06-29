import type {
  TechnicalFinding,
  VisibilityResult,
  CoverageItem,
  AuthorityOpportunity,
  FindingSeverity,
} from "@/types/database";
import { calculateVisibilityMetrics } from "@/lib/engines/visibility-scanner";

/**
 * Unified 7-lever AEO Readiness score.
 *
 * Deterministic levers (L1 crawlability, L2 passages, L3 schema, L7 freshness)
 * are controllable and form the Tier-1 "guaranteed deliverables". Probabilistic
 * levers (L4 entity, L5 authority, L6 comparison wins) are influenced and
 * proven via the measured visibility delta.
 */

export type LeverId =
  | "crawlability"
  | "passages"
  | "schema"
  | "entity"
  | "authority"
  | "comparison"
  | "freshness";

export type LeverType = "deterministic" | "probabilistic";

export interface AeoLever {
  id: LeverId;
  name: string;
  type: LeverType;
  score: number;
  status: "strong" | "moderate" | "weak";
  blockers: string[];
  nextAction: string;
  owningEngine: string;
}

export interface AeoReadiness {
  readinessScore: number;
  deterministicScore: number;
  probabilisticScore: number;
  levers: AeoLever[];
  /** Tier-1 deterministic deliverables shipped (for the guarantee). */
  deterministicDeliverablesMet: boolean;
  nextBestActions: string[];
}

export interface AeoReadinessInputs {
  technicalFindings: Array<Pick<TechnicalFinding, "category" | "severity" | "title" | "fix_recommendation">>;
  visibilityResults: Array<Pick<VisibilityResult, "engine" | "brand_mentioned" | "brand_cited" | "competitor_mentions" | "raw_response" | "source_domains" | "prompt_text">>;
  entityScore?: number;
  /** Brand has a Wikipedia article (strong AEO/LLM citation signal). */
  hasWikipedia?: boolean;
  /** Brand has a Wikidata entity (structured knowledge-graph presence). */
  hasWikidata?: boolean;
  coverageItems?: Array<Pick<CoverageItem, "surface" | "is_present">>;
  authorityOpportunities?: Array<Pick<AuthorityOpportunity, "status">>;
  /** 0-100 unified Authority Rating (Tranco + Common Crawl + OpenPageRank + age) */
  domainAuthority?: number;
  /** 0-100 PageSpeed retrieval-health score */
  pageSpeedScore?: number;
}

const SEVERITY_PENALTY: Record<FindingSeverity, number> = {
  critical: 40,
  high: 25,
  medium: 10,
  low: 4,
  info: 0,
};

const LEVER_WEIGHTS: Record<LeverId, number> = {
  crawlability: 0.2,
  passages: 0.2,
  schema: 0.15,
  entity: 0.15,
  authority: 0.15,
  comparison: 0.1,
  freshness: 0.05,
};

const COMPARISON_RE = /\b(best|top|vs\.?|versus|alternative|alternatives|compare|comparison|review)\b/i;

function scoreFromFindings(
  findings: AeoReadinessInputs["technicalFindings"],
  categories: string[]
): { score: number; blockers: string[]; nextAction?: string } {
  const relevant = findings.filter((f) => categories.includes(f.category));
  const penalty = relevant.reduce((sum, f) => sum + (SEVERITY_PENALTY[f.severity] || 0), 0);
  const blockers = relevant
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .map((f) => f.title);
  const nextAction = relevant
    .slice()
    .sort((a, b) => (SEVERITY_PENALTY[b.severity] || 0) - (SEVERITY_PENALTY[a.severity] || 0))[0]
    ?.fix_recommendation;
  return { score: Math.max(0, 100 - penalty), blockers, nextAction };
}

function statusOf(score: number): AeoLever["status"] {
  if (score >= 75) return "strong";
  if (score >= 45) return "moderate";
  return "weak";
}

export function calculateAeoReadiness(inputs: AeoReadinessInputs): AeoReadiness {
  const findings = inputs.technicalFindings || [];

  // L1 — AI crawlability (deterministic)
  const crawl = scoreFromFindings(findings, ["robots", "ai_bot_access", "crawlability", "indexability", "index_coverage"]);
  const l1: AeoLever = {
    id: "crawlability",
    name: "AI crawlability & indexing",
    type: "deterministic",
    score: crawl.score,
    status: statusOf(crawl.score),
    blockers: crawl.blockers,
    nextAction: crawl.nextAction || "Keep AI bots (GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot, Google-Extended) allowed and pages indexed.",
    owningEngine: "technical-audit",
  };

  // L2 — Answer-ready passages (deterministic), blended with page speed
  const passage = scoreFromFindings(findings, ["passage", "on_page", "content"]);
  const passageScore = inputs.pageSpeedScore !== undefined
    ? Math.round(passage.score * 0.75 + inputs.pageSpeedScore * 0.25)
    : passage.score;
  const l2: AeoLever = {
    id: "passages",
    name: "Answer-ready passages",
    type: "deterministic",
    score: passageScore,
    status: statusOf(passageScore),
    blockers: passage.blockers,
    nextAction: passage.nextAction || "Open each section with a 40-80 word direct answer and size key blocks to 120-180 words.",
    owningEngine: "passage-readiness",
  };

  // L3 — Structured data (deterministic)
  const schema = scoreFromFindings(findings, ["schema"]);
  const l3: AeoLever = {
    id: "schema",
    name: "Structured data (schema)",
    type: "deterministic",
    score: schema.score,
    status: statusOf(schema.score),
    blockers: schema.blockers,
    nextAction: schema.nextAction || "Deploy Organization, FAQPage, and Article/Product schema sitewide (Article/FAQ/HowTo lift AI selection ~73%).",
    owningEngine: "schema-engine",
  };

  // L4 — Entity consistency (probabilistic / high control). Wikipedia + Wikidata
  // presence are disproportionately strong LLM-citation signals, so they boost
  // the base entity score.
  const presenceBoost = (inputs.hasWikipedia ? 20 : 0) + (inputs.hasWikidata ? 15 : 0);
  const entityScore = clamp((inputs.entityScore ?? 0) + presenceBoost);
  const entityBlockers: string[] = [];
  if (!inputs.hasWikipedia) entityBlockers.push("No Wikipedia article (high-value AI-citation source)");
  if (entityScore < 45) entityBlockers.push("Weak or inconsistent entity graph");
  const l4: AeoLever = {
    id: "entity",
    name: "Entity consistency",
    type: "probabilistic",
    score: entityScore,
    status: statusOf(entityScore),
    blockers: entityBlockers,
    nextAction: entityScore < 75
      ? "Align name/category across Wikidata, Wikipedia, Crunchbase, G2, LinkedIn and add sameAs JSON-LD."
      : "Maintain entity consistency across knowledge-graph sources.",
    owningEngine: "entity-engine",
  };

  // L5 — Authority & off-site consensus (probabilistic)
  const authorityScore = computeAuthority(inputs);
  const l5: AeoLever = {
    id: "authority",
    name: "Authority & off-site consensus",
    type: "probabilistic",
    score: authorityScore,
    status: statusOf(authorityScore),
    blockers: authorityScore < 45 ? ["Low domain authority / few trusted citing sources"] : [],
    nextAction: authorityScore < 75
      ? "Earn placements on the listicles, review sites, and communities AI engines already cite (Reddit, G2, industry roundups)."
      : "Sustain authority with fresh earned mentions and reviews.",
    owningEngine: "authority-finder",
  };

  // L6 — Comparison / listicle wins (probabilistic)
  const comparison = computeComparisonWins(inputs.visibilityResults);
  const l6: AeoLever = {
    id: "comparison",
    name: "Comparison & 'best of' wins",
    type: "probabilistic",
    score: comparison,
    status: statusOf(comparison),
    blockers: comparison < 45 ? ["Losing buyer-intent comparison prompts"] : [],
    nextAction: comparison < 75
      ? "Create comparison/alternative pages and earn listicle placements for the 'best X' prompts you're losing."
      : "Defend comparison prompts and expand into adjacent categories.",
    owningEngine: "prompt-generator + visibility-scanner",
  };

  // L7 — Freshness (deterministic)
  const fresh = scoreFromFindings(findings, ["freshness"]);
  const l7: AeoLever = {
    id: "freshness",
    name: "Freshness & recency",
    type: "deterministic",
    score: fresh.score,
    status: statusOf(fresh.score),
    blockers: fresh.blockers,
    nextAction: fresh.nextAction || "Refresh key pages on a schedule and add the current-year signal to titles where accurate.",
    owningEngine: "passage-readiness + freshness cron",
  };

  const levers = [l1, l2, l3, l4, l5, l6, l7];

  const readinessScore = Math.round(
    levers.reduce((sum, lv) => sum + lv.score * LEVER_WEIGHTS[lv.id], 0)
  );

  const deterministic = levers.filter((l) => l.type === "deterministic");
  const probabilistic = levers.filter((l) => l.type === "probabilistic");
  const deterministicScore = avg(deterministic.map((l) => l.score));
  const probabilisticScore = avg(probabilistic.map((l) => l.score));

  const deterministicDeliverablesMet = deterministic.every((l) => l.score >= 70);

  const nextBestActions = levers
    .slice()
    .sort((a, b) => leverPriority(a) - leverPriority(b))
    .filter((l) => l.score < 75)
    .slice(0, 3)
    .map((l) => `${l.name}: ${l.nextAction}`);

  return {
    readinessScore,
    deterministicScore,
    probabilisticScore,
    levers,
    deterministicDeliverablesMet,
    nextBestActions,
  };
}

/** Deterministic levers first, then by lowest score. */
function leverPriority(l: AeoLever): number {
  const typeRank = l.type === "deterministic" ? 0 : 1000;
  return typeRank + l.score;
}

function computeAuthority(inputs: AeoReadinessInputs): number {
  const da = inputs.domainAuthority;
  const opps = inputs.authorityOpportunities || [];
  const published = opps.filter((o) => o.status === "published").length;
  const publishedScore = opps.length > 0 ? Math.min((published / opps.length) * 100, 100) : 0;
  const sourceDomains = new Set(
    inputs.visibilityResults.flatMap((r) => (Array.isArray(r.source_domains) ? r.source_domains : []))
  );
  const sourceScore = Math.min(sourceDomains.size * 10, 100);

  // When Tranco authority is unknown (unlisted/unreachable), don't let a 0
  // unfairly drag the lever — lean on earned placements + citing sources.
  if (typeof da !== "number" || da <= 0) {
    return clamp(Math.round(publishedScore * 0.5 + sourceScore * 0.5));
  }
  // Domain authority dominates; earned placements + citing sources supplement.
  return clamp(Math.round(da * 0.6 + publishedScore * 0.2 + sourceScore * 0.2));
}

function computeComparisonWins(
  results: AeoReadinessInputs["visibilityResults"]
): number {
  const comparison = results.filter((r) => COMPARISON_RE.test(r.prompt_text || ""));
  const pool = comparison.length >= 3 ? comparison : results;
  if (pool.length === 0) return 0;
  const metrics = calculateVisibilityMetrics(
    pool.map((r) => ({
      brand_mentioned: r.brand_mentioned,
      brand_cited: r.brand_cited,
      competitor_mentions: r.competitor_mentions,
      raw_response: r.raw_response,
    }))
  );
  // Blend win-rate and share-of-voice into a 0-100 comparison score.
  return clamp(Math.round((metrics.winRate * 0.5 + metrics.shareOfVoice * 0.5) * 100));
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}
