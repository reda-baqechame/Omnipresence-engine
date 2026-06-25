/**
 * Paid ads replacement calculator — estimates organic traffic value vs ad spend.
 */

export interface AdsEquivalentResult {
  organicSessions: number;
  aiReferralSessions: number;
  estimatedCpc: number;
  organicValue: number;
  aiValue: number;
  totalOrganicValue: number;
  statedAdSpend: number;
  replacementRatio: number;
  savingsEstimate: number;
  /** "real" = Google Ads Keyword Planner CPC; "industry_estimate" = static default. */
  cpcSource: "real" | "industry_estimate";
}

const DEFAULT_CPC_BY_INDUSTRY: Record<string, number> = {
  legal: 8.5,
  dental: 6.2,
  saas: 4.5,
  ecommerce: 1.2,
  local: 3.5,
  default: 2.8,
};

export function calculateAdsEquivalent(opts: {
  organicSessions?: number;
  aiReferralSessions?: number;
  monthlyAdSpend?: number;
  industry?: string;
  customCpc?: number;
}): AdsEquivalentResult {
  const organicSessions = opts.organicSessions ?? 0;
  const aiReferralSessions = opts.aiReferralSessions ?? 0;
  const statedAdSpend = opts.monthlyAdSpend ?? 0;
  const estimatedCpc =
    opts.customCpc ??
    DEFAULT_CPC_BY_INDUSTRY[opts.industry?.toLowerCase() || ""] ??
    DEFAULT_CPC_BY_INDUSTRY.default;
  const cpcSource: AdsEquivalentResult["cpcSource"] =
    opts.customCpc !== undefined ? "real" : "industry_estimate";

  const organicValue = Math.round(organicSessions * estimatedCpc);
  const aiValue = Math.round(aiReferralSessions * estimatedCpc * 1.15);
  const totalOrganicValue = organicValue + aiValue;
  const replacementRatio =
    statedAdSpend > 0 ? Math.min(1, totalOrganicValue / statedAdSpend) : 0;
  const savingsEstimate = Math.max(0, totalOrganicValue - statedAdSpend * 0.3);

  return {
    organicSessions,
    aiReferralSessions,
    estimatedCpc,
    organicValue,
    aiValue,
    totalOrganicValue,
    statedAdSpend,
    replacementRatio,
    savingsEstimate,
    cpcSource,
  };
}
