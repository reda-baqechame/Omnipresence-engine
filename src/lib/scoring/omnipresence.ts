import type {
  TechnicalFinding,
  VisibilityResult,
  CoverageItem,
  AuthorityOpportunity,
  OmniPresenceScore,
} from "@/types/database";
import { resultDataQuality, isCountableVisibility } from "@/lib/engines/provenance";

/** Measured-only pool — never mix simulated/unavailable into a real score. */
function scorePool(results: VisibilityResult[]): VisibilityResult[] {
  const measured = results.filter((r) => isCountableVisibility(resultDataQuality(r)));
  if (measured.length) return measured;
  // No measured data: fall back to demo rows only when the WHOLE set is demo
  // (preview mode). Real-but-unmeasured rows score as no-data, never inflated.
  const demo = results.filter((r) => resultDataQuality(r) === "simulated");
  return demo.length === results.length ? demo : measured;
}

/** Coverage items we could actually verify (unavailable = unknown, not "missing"). */
function verifiedCoverage(items: CoverageItem[]): CoverageItem[] {
  return items.filter((c) => c.data_quality !== "unavailable");
}

export interface ScoreInputs {
  visibilityResults: VisibilityResult[];
  technicalFindings: TechnicalFinding[];
  coverageItems: CoverageItem[];
  authorityOpportunities: AuthorityOpportunity[];
  hasConversionTracking: boolean;
  hasGbp: boolean;
  monthlyTraffic?: number;
  /** 0-100 Tranco domain authority (optional) */
  domainAuthority?: number;
  /** 0-100 PageSpeed retrieval-health score (optional) */
  pageSpeedScore?: number;
  /** 0-100 behavioral conversion-readiness signal from Clarity (optional) */
  behaviorSignal?: number;
}

const WEIGHTS = {
  ai_visibility: 0.20,
  search_visibility: 0.15,
  local_visibility: 0.10,
  social_presence: 0.10,
  directory_coverage: 0.10,
  authority_mentions: 0.15,
  technical_readiness: 0.10,
  conversion_readiness: 0.10,
};

export function calculateOmniPresenceScore(inputs: ScoreInputs): Omit<OmniPresenceScore, "id" | "project_id" | "created_at"> {
  const pool = scorePool(inputs.visibilityResults);
  const coverage = verifiedCoverage(inputs.coverageItems);

  // Which surfaces did we actually measure? A dimension we couldn't measure must
  // NOT be scored as 0 — that produces a false "Invisible" verdict (e.g. a
  // confident omnipresence:0 for a giant brand when no SERP key is configured),
  // which is exactly what makes an expert distrust the tool. Instead we
  // re-normalize the weights over the dimensions that have real data.
  const aiResults = pool.filter((r) =>
    ["chatgpt", "perplexity", "gemini", "claude", "google_ai_overview", "bing_copilot"].includes(r.engine)
  );
  const searchResults = pool.filter((r) => ["google_organic", "bing_organic"].includes(r.engine));
  const localItems = coverage.filter((c) =>
    ["google_business", "bing_places", "apple_business", "yelp"].includes(c.surface)
  );
  const socialItems = coverage.filter((c) =>
    ["linkedin", "x_twitter", "facebook", "instagram", "tiktok", "youtube"].includes(c.surface)
  );
  const dirItems = coverage.filter((c) =>
    ["g2", "capterra", "trustpilot", "directory", "review_site"].includes(c.surface)
  );
  const hasAuthoritySignal =
    inputs.authorityOpportunities.length > 0 ||
    (typeof inputs.domainAuthority === "number" && inputs.domainAuthority > 0) ||
    pool.some((r) => r.source_domains.length > 0);

  const dimensions = {
    ai_visibility: { value: calculateAIVisibility(pool), available: aiResults.length > 0 },
    search_visibility: { value: calculateSearchVisibility(pool), available: searchResults.length > 0 },
    local_visibility: { value: calculateLocalVisibility(coverage, inputs.hasGbp), available: localItems.length > 0 || inputs.hasGbp },
    social_presence: { value: calculateSocialPresence(coverage), available: socialItems.length > 0 },
    directory_coverage: { value: calculateDirectoryCoverage(coverage), available: dirItems.length > 0 },
    authority_mentions: { value: calculateAuthorityMentions(inputs.authorityOpportunities, pool, inputs.domainAuthority), available: hasAuthoritySignal },
    // The technical audit always runs for real (keyless), so it's always measured.
    technical_readiness: { value: calculateTechnicalReadiness(inputs.technicalFindings, inputs.pageSpeedScore), available: true },
    conversion_readiness: { value: calculateConversionReadiness(inputs.hasConversionTracking, inputs.monthlyTraffic, inputs.behaviorSignal), available: true },
  } as const;

  // Weighted average over ONLY the available dimensions (re-normalized).
  let weightedSum = 0;
  let availableWeight = 0;
  const availability: Record<string, boolean> = {};
  for (const [key, dim] of Object.entries(dimensions)) {
    availability[key] = dim.available;
    if (dim.available) {
      const w = WEIGHTS[key as keyof typeof WEIGHTS];
      weightedSum += dim.value * w;
      availableWeight += w;
    }
  }
  const omnipresenceScore = availableWeight > 0 ? weightedSum / availableWeight : 0;
  const dimensionCoverage = Math.round((availableWeight / 1) * 100) / 100; // weights sum to 1

  const measuredInputs = inputs.visibilityResults.filter(
    (r) => isCountableVisibility(resultDataQuality(r))
  ).length;
  const groundedInputs = inputs.visibilityResults.filter(
    (r) => resultDataQuality(r) === "measured"
  ).length;
  const totalInputs = inputs.visibilityResults.length;
  const allSimulated = totalInputs > 0 && measuredInputs === 0 && pool.length > 0;

  return {
    omnipresence_score: Math.round(omnipresenceScore * 100) / 100,
    ai_visibility: Math.round(dimensions.ai_visibility.value * 100) / 100,
    search_visibility: Math.round(dimensions.search_visibility.value * 100) / 100,
    local_visibility: Math.round(dimensions.local_visibility.value * 100) / 100,
    social_presence: Math.round(dimensions.social_presence.value * 100) / 100,
    directory_coverage: Math.round(dimensions.directory_coverage.value * 100) / 100,
    authority_mentions: Math.round(dimensions.authority_mentions.value * 100) / 100,
    technical_readiness: Math.round(dimensions.technical_readiness.value * 100) / 100,
    conversion_readiness: Math.round(dimensions.conversion_readiness.value * 100) / 100,
    data_source: groundedInputs > 0 ? "measured" : measuredInputs > 0 ? "model_knowledge" : allSimulated ? "simulated" : "unavailable",
    confidence: totalInputs > 0 ? Math.round((measuredInputs / totalInputs) * 100) / 100 : 0,
    measured_inputs: measuredInputs,
    total_inputs: totalInputs,
    breakdown: {
      weights: WEIGHTS,
      // How much of the scoring surface we could actually measure (0-1). A score
      // built on 0.2 coverage is honest about being partial, not a false zero.
      dimension_coverage: dimensionCoverage,
      dimension_availability: availability,
      visibilityResultCount: inputs.visibilityResults.length,
      measuredVisibilityCount: measuredInputs,
      technicalFindingCount: inputs.technicalFindings.length,
      coverageItemCount: inputs.coverageItems.length,
      verifiedCoverageCount: coverage.length,
      authorityOpportunityCount: inputs.authorityOpportunities.length,
    },
  };
}

function calculateAIVisibility(results: VisibilityResult[]): number {
  const aiEngines = ["chatgpt", "perplexity", "gemini", "claude", "google_ai_overview", "bing_copilot"];
  const aiResults = results.filter((r) => aiEngines.includes(r.engine));
  if (aiResults.length === 0) return 0;

  const mentionRate = aiResults.filter((r) => r.brand_mentioned).length / aiResults.length;
  const citationRate = aiResults.filter((r) => r.brand_cited).length / aiResults.length;

  const competitorMentionTotal = aiResults.reduce((sum, r) => {
    return sum + Object.values(r.competitor_mentions).filter(Boolean).length;
  }, 0);
  const brandMentionTotal = aiResults.filter((r) => r.brand_mentioned).length;
  const competitiveRatio =
    competitorMentionTotal > 0
      ? brandMentionTotal / (brandMentionTotal + competitorMentionTotal)
      : brandMentionTotal > 0 ? 1 : 0;

  // Rates are 0-1; weights sum to 100 → result is already on the 0-100 scale.
  return mentionRate * 40 + citationRate * 40 + competitiveRatio * 20;
}

function calculateSearchVisibility(results: VisibilityResult[]): number {
  const searchEngines = ["google_organic", "bing_organic"];
  const searchResults = results.filter((r) => searchEngines.includes(r.engine));
  if (searchResults.length === 0) return 0;

  const mentionRate = searchResults.filter((r) => r.brand_mentioned || r.brand_cited).length / searchResults.length;
  return mentionRate * 100;
}

function calculateLocalVisibility(coverage: CoverageItem[], hasGbp: boolean): number {
  const localSurfaces = ["google_business", "bing_places", "apple_business", "yelp"];
  const localItems = coverage.filter((c) => localSurfaces.includes(c.surface));
  if (localItems.length === 0) return hasGbp ? 30 : 0;

  const presentRate = localItems.filter((c) => c.is_present).length / localItems.length;
  const optimizedRate = localItems.filter((c) => c.is_optimized).length / localItems.length;

  return presentRate * 60 + optimizedRate * 40;
}

function calculateSocialPresence(coverage: CoverageItem[]): number {
  const socialSurfaces = ["linkedin", "x_twitter", "facebook", "instagram", "tiktok", "youtube"];
  const socialItems = coverage.filter((c) => socialSurfaces.includes(c.surface));
  if (socialItems.length === 0) return 0;

  const presentRate = socialItems.filter((c) => c.is_present).length / socialItems.length;
  const optimizedRate = socialItems.filter((c) => c.is_optimized).length / socialItems.length;

  return presentRate * 70 + optimizedRate * 30;
}

function calculateDirectoryCoverage(coverage: CoverageItem[]): number {
  const dirSurfaces = ["g2", "capterra", "trustpilot", "directory", "review_site"];
  const dirItems = coverage.filter((c) => dirSurfaces.includes(c.surface));
  if (dirItems.length === 0) return 0;

  const presentRate = dirItems.filter((c) => c.is_present).length / dirItems.length;
  return presentRate * 100;
}

function calculateAuthorityMentions(
  opportunities: AuthorityOpportunity[],
  visibilityResults: VisibilityResult[],
  domainAuthority?: number
): number {
  const published = opportunities.filter((o) => o.status === "published").length;
  const identified = opportunities.length;
  const opportunityScore = identified > 0 ? (published / identified) * 50 : 0;

  const uniqueSourceDomains = new Set(
    visibilityResults.flatMap((r) => r.source_domains)
  );
  const sourceScore = Math.min(uniqueSourceDomains.size * 5, 50);

  const base = opportunityScore + sourceScore;

  // Blend in Tranco domain authority when available (the AI link-graph
  // heuristic that makes high-authority domains ~3.5x more likely to be cited).
  if (typeof domainAuthority === "number" && domainAuthority > 0) {
    return Math.min(100, base * 0.7 + domainAuthority * 0.3);
  }
  return base;
}

function calculateTechnicalReadiness(findings: TechnicalFinding[], pageSpeedScore?: number): number {
  const severityWeights: Record<string, number> = {
    critical: 25,
    high: 15,
    medium: 8,
    low: 3,
    info: 0,
  };

  const penalty = findings
    .filter((f) => !f.is_resolved)
    .reduce((sum, f) => sum + (severityWeights[f.severity] || 0), 0);

  const findingsScore = findings.length === 0 ? 50 : Math.max(0, 100 - penalty);

  // Blend in measured page speed (slow pages time out during AI retrieval).
  if (typeof pageSpeedScore === "number") {
    return Math.round(findingsScore * 0.8 + pageSpeedScore * 0.2);
  }
  return findingsScore;
}

function calculateConversionReadiness(
  hasTracking: boolean,
  monthlyTraffic?: number,
  behaviorSignal?: number
): number {
  let score = 0;
  if (hasTracking) score += 50;
  if (monthlyTraffic && monthlyTraffic > 1000) score += 30;
  else if (monthlyTraffic && monthlyTraffic > 100) score += 15;
  score += 20; // Base for having a website
  score = Math.min(score, 100);

  // Blend in measured behavioral health (Clarity) when available: real UX
  // friction is a stronger conversion-readiness signal than tracking presence.
  if (typeof behaviorSignal === "number") {
    return Math.round(score * 0.5 + behaviorSignal * 0.5);
  }
  return score;
}

export function getScoreLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Dominant", color: "text-green-500" };
  if (score >= 60) return { label: "Strong", color: "text-emerald-500" };
  if (score >= 40) return { label: "Moderate", color: "text-yellow-500" };
  if (score >= 20) return { label: "Weak", color: "text-orange-500" };
  return { label: "Invisible", color: "text-red-500" };
}

export function getScoreColor(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-emerald-500";
  if (score >= 40) return "bg-yellow-500";
  if (score >= 20) return "bg-orange-500";
  return "bg-red-500";
}
