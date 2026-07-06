import type {
  AuthorityOpportunity,
  CoverageItem,
  OmniPresenceScore,
  Project,
  RoadmapItem,
  TechnicalFinding,
  VisibilityResult,
} from "@/types/database";
import type { CompetitiveSnapshot } from "@/lib/engines/competitive-snapshot";
import type { HonestVisibilitySnapshot } from "@/lib/engines/visibility-scope";
import type { PopularitySignal } from "@/lib/engines/popularity-signal";

/** Report-level data quality label (aligned with popularity-signal convention). */
export type ReportDataQuality = "measured" | "estimated_proxy" | "not_available";

export type IntelligenceReportSectionId =
  | "executive"
  | "competitive"
  | "visibility"
  | "keywords"
  | "backlinks"
  | "technical"
  | "local"
  | "entity"
  | "schema"
  | "community"
  | "reputation"
  | "ppc"
  | "roi"
  | "roadmap"
  | "proof"
  | "methodology";

export const ALL_INTELLIGENCE_SECTIONS: IntelligenceReportSectionId[] = [
  "executive",
  "competitive",
  "visibility",
  "keywords",
  "backlinks",
  "technical",
  "local",
  "entity",
  "schema",
  "community",
  "reputation",
  "ppc",
  "roi",
  "roadmap",
  "proof",
  "methodology",
];

export interface ReportAttribution {
  source: string;
  license?: string;
  url?: string;
}

export interface SectionMeta {
  available: boolean;
  dataQuality: ReportDataQuality;
  note?: string;
  attributions?: ReportAttribution[];
}

export interface KeywordRow {
  keyword: string;
  volume?: number;
  difficulty?: number;
  intent?: string;
  position?: number;
  url?: string;
  dataQuality: ReportDataQuality;
}

export interface BacklinkRow {
  domain: string;
  url?: string;
  dataQuality: ReportDataQuality;
}

export interface CommunityRow {
  platform: string;
  title: string;
  url?: string;
  sentiment?: string;
}

export interface SourceGraphNode {
  domain: string;
  influence: number;
  citations: number;
}

export interface IntelligenceReportMeta {
  reportType: "standard" | "deep";
  project: Project;
  generatedAt: string;
  sectionsIncluded: IntelligenceReportSectionId[];
  brandName: string;
  domain: string;
}

export interface IntelligenceExecutiveSummary extends SectionMeta {
  omnipresenceScore: number;
  scoreLabel: string;
  subScores: Record<string, number>;
  narrative?: string;
  keyFindings: string[];
  scoreDelta?: number;
}

export interface IntelligenceCompetitiveSection extends SectionMeta {
  target?: CompetitiveSnapshot;
  competitors: CompetitiveSnapshot[];
  popularityDetail?: PopularitySignal;
}

export interface IntelligenceVisibilitySection extends SectionMeta {
  snapshot: HonestVisibilitySnapshot;
  topWinPrompts: Array<{
    prompt: string;
    engine: string;
    winner: string;
  }>;
  competitorWinCount: number;
}

export interface IntelligenceKeywordsSection extends SectionMeta {
  opportunities: KeywordRow[];
  strikingDistance: KeywordRow[];
  totalTracked: number;
}

export interface IntelligenceBacklinksSection extends SectionMeta {
  referringDomains: number;
  topReferrers: BacklinkRow[];
  authorityRating?: number;
  authoritySources: string[];
}

export interface IntelligenceTechnicalSection extends SectionMeta {
  findings: TechnicalFinding[];
  criticalCount: number;
  highCount: number;
  cwv?: {
    lcp?: number;
    cls?: number;
    inp?: number;
    dataQuality: ReportDataQuality;
  };
}

export interface IntelligenceLocalSection extends SectionMeta {
  listingsFound: number;
  napConsistent?: boolean;
  gaps: string[];
}

export interface IntelligenceEntitySection extends SectionMeta {
  knowledgeGraph?: boolean;
  sameAsCount: number;
  gaps: string[];
}

export interface IntelligenceSchemaSection extends SectionMeta {
  deployments: number;
  types: string[];
  issues: string[];
}

export interface IntelligenceCommunitySection extends SectionMeta {
  mentions: CommunityRow[];
  totalMentions: number;
}

export interface IntelligenceReputationSection extends SectionMeta {
  newsMentions: number;
  sentiment?: string;
  highlights: string[];
}

export interface IntelligencePpcSection extends SectionMeta {
  competitorAdCount: number;
  estimatedMonthlySavings?: number;
  highlights: string[];
}

export interface IntelligenceRoiSection extends SectionMeta {
  organicSessions?: number;
  aiReferralSessions?: number;
  adsEquivalent?: number;
  replacementRatio?: number;
  cpcSource?: string;
}

export interface IntelligenceRoadmapSection extends SectionMeta {
  items: RoadmapItem[];
}

export interface IntelligenceProofSection extends SectionMeta {
  proofHtml?: string;
  ledgerActions: number;
  guaranteeTier?: string;
  deliverablesMet: number;
  deliverablesTotal: number;
}

export interface IntelligenceMethodologySection extends SectionMeta {
  providersUsed: string[];
  attributions: ReportAttribution[];
  disclaimers: string[];
}

/** Full deep intelligence report payload. */
export interface IntelligenceReport {
  meta: IntelligenceReportMeta;
  executive: IntelligenceExecutiveSummary;
  competitive: IntelligenceCompetitiveSection;
  visibility: IntelligenceVisibilitySection;
  keywords: IntelligenceKeywordsSection;
  backlinks: IntelligenceBacklinksSection;
  technical: IntelligenceTechnicalSection;
  local: IntelligenceLocalSection;
  entity: IntelligenceEntitySection;
  schema: IntelligenceSchemaSection;
  community: IntelligenceCommunitySection;
  reputation: IntelligenceReputationSection;
  ppc: IntelligencePpcSection;
  roi: IntelligenceRoiSection;
  roadmap: IntelligenceRoadmapSection;
  proof: IntelligenceProofSection;
  methodology: IntelligenceMethodologySection;
  /** Standard report fields reused in deep mode */
  coverageItems: CoverageItem[];
  authorityOpportunities: AuthorityOpportunity[];
  score: OmniPresenceScore;
  previousScore?: OmniPresenceScore;
  visibilityResults: VisibilityResult[];
}

export interface IntelligenceReportBranding {
  name: string;
  color: string;
  logoUrl?: string;
  domain?: string;
}
