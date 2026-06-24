import type {
  TechnicalFinding,
  VisibilityResult,
  CoverageItem,
  AuthorityOpportunity,
  OmniPresenceScore,
} from "@/types/database";

export interface ScoreInputs {
  visibilityResults: VisibilityResult[];
  technicalFindings: TechnicalFinding[];
  coverageItems: CoverageItem[];
  authorityOpportunities: AuthorityOpportunity[];
  hasConversionTracking: boolean;
  hasGbp: boolean;
  monthlyTraffic?: number;
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
  const aiVisibility = calculateAIVisibility(inputs.visibilityResults);
  const searchVisibility = calculateSearchVisibility(inputs.visibilityResults);
  const localVisibility = calculateLocalVisibility(inputs.coverageItems, inputs.hasGbp);
  const socialPresence = calculateSocialPresence(inputs.coverageItems);
  const directoryCoverage = calculateDirectoryCoverage(inputs.coverageItems);
  const authorityMentions = calculateAuthorityMentions(inputs.authorityOpportunities, inputs.visibilityResults);
  const technicalReadiness = calculateTechnicalReadiness(inputs.technicalFindings);
  const conversionReadiness = calculateConversionReadiness(inputs.hasConversionTracking, inputs.monthlyTraffic);

  const omnipresenceScore =
    aiVisibility * WEIGHTS.ai_visibility +
    searchVisibility * WEIGHTS.search_visibility +
    localVisibility * WEIGHTS.local_visibility +
    socialPresence * WEIGHTS.social_presence +
    directoryCoverage * WEIGHTS.directory_coverage +
    authorityMentions * WEIGHTS.authority_mentions +
    technicalReadiness * WEIGHTS.technical_readiness +
    conversionReadiness * WEIGHTS.conversion_readiness;

  return {
    omnipresence_score: Math.round(omnipresenceScore * 100) / 100,
    ai_visibility: Math.round(aiVisibility * 100) / 100,
    search_visibility: Math.round(searchVisibility * 100) / 100,
    local_visibility: Math.round(localVisibility * 100) / 100,
    social_presence: Math.round(socialPresence * 100) / 100,
    directory_coverage: Math.round(directoryCoverage * 100) / 100,
    authority_mentions: Math.round(authorityMentions * 100) / 100,
    technical_readiness: Math.round(technicalReadiness * 100) / 100,
    conversion_readiness: Math.round(conversionReadiness * 100) / 100,
    breakdown: {
      weights: WEIGHTS,
      visibilityResultCount: inputs.visibilityResults.length,
      technicalFindingCount: inputs.technicalFindings.length,
      coverageItemCount: inputs.coverageItems.length,
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

  return (mentionRate * 40 + citationRate * 40 + competitiveRatio * 20) * 100;
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

  return (presentRate * 60 + optimizedRate * 40) * 100;
}

function calculateSocialPresence(coverage: CoverageItem[]): number {
  const socialSurfaces = ["linkedin", "x_twitter", "facebook", "instagram", "tiktok", "youtube"];
  const socialItems = coverage.filter((c) => socialSurfaces.includes(c.surface));
  if (socialItems.length === 0) return 0;

  const presentRate = socialItems.filter((c) => c.is_present).length / socialItems.length;
  const optimizedRate = socialItems.filter((c) => c.is_optimized).length / socialItems.length;

  return (presentRate * 70 + optimizedRate * 30) * 100;
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
  visibilityResults: VisibilityResult[]
): number {
  const published = opportunities.filter((o) => o.status === "published").length;
  const identified = opportunities.length;
  const opportunityScore = identified > 0 ? (published / identified) * 50 : 0;

  const uniqueSourceDomains = new Set(
    visibilityResults.flatMap((r) => r.source_domains)
  );
  const sourceScore = Math.min(uniqueSourceDomains.size * 5, 50);

  return opportunityScore + sourceScore;
}

function calculateTechnicalReadiness(findings: TechnicalFinding[]): number {
  if (findings.length === 0) return 50;

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

  return Math.max(0, 100 - penalty);
}

function calculateConversionReadiness(
  hasTracking: boolean,
  monthlyTraffic?: number
): number {
  let score = 0;
  if (hasTracking) score += 50;
  if (monthlyTraffic && monthlyTraffic > 1000) score += 30;
  else if (monthlyTraffic && monthlyTraffic > 100) score += 15;
  score += 20; // Base for having a website
  return Math.min(score, 100);
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
