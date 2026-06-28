import { preferLiveData, hasSerpCapability, getCapabilitiesSummary } from "@/lib/config/capabilities";
import { generatePromptUniverse, generateTemplatePrompts } from "@/lib/engines/prompt-generator";
import { runVisibilityScan, calculateVisibilityMetrics } from "@/lib/engines/visibility-scanner";
import { findAuthorityOpportunities } from "@/lib/engines/authority-finder";
import { checkPlatformCoverage } from "@/lib/engines/coverage-checker";
import { getBacklinksFree } from "@/lib/providers/backlinks-free";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import type { VisibilityEngine, VisibilityResult } from "@/types/database";
import type { TechnicalAuditFinding } from "@/lib/engines/technical-audit";
import {
  generateDemoPrompts,
  generateDemoVisibilityResults,
  generateDemoAuthorityOpportunities,
} from "@/lib/demo/scan-data";

const PUBLIC_PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const MAX_PUBLIC_PROMPTS = 5;

function selectPublicEngines(): VisibilityEngine[] {
  const engines: VisibilityEngine[] = [];
  if (process.env.PERPLEXITY_API_KEY) engines.push("perplexity");
  if (hasSerpCapability()) engines.push("google_organic", "google_ai_overview");
  if (process.env.OPENAI_API_KEY) engines.push("chatgpt");
  return engines.length ? engines : ["google_organic"];
}

export interface PublicAuditIntelligence {
  liveData: boolean;
  dataMode: "measured" | "demo";
  providers: ReturnType<typeof getCapabilitiesSummary>;
  visibilityResults: Array<Pick<VisibilityResult, "engine" | "prompt_text" | "brand_mentioned" | "brand_cited" | "source_domains">>;
  visibilityMetrics: ReturnType<typeof calculateVisibilityMetrics>;
  authorityOpportunities: Array<{
    type: string;
    target_site: string;
    pitch_angle: string;
    estimated_impact: number;
  }>;
  coverageGaps: string[];
  coverageItems: Array<{
    platform_name: string;
    is_present: boolean;
    competitor_present: boolean;
    surface: string;
  }>;
  backlinkCount: number;
  /** False when no backlink index/provider is configured — render as "unavailable", not 0. */
  backlinksAvailable: boolean;
  serpPresence: boolean;
}

export async function runPublicAuditIntelligence(input: {
  domain: string;
  brandName: string;
  industry: string;
  location?: string;
  competitors?: string[];
}): Promise<PublicAuditIntelligence> {
  const providers = getCapabilitiesSummary();
  const live = preferLiveData();
  const location = input.location || "United States";
  const competitors = input.competitors || [];

  if (!live) {
    const demoPrompts = generateDemoPrompts(PUBLIC_PROJECT_ID, input.brandName, input.industry, location, competitors);
    const visibilityResults = generateDemoVisibilityResults(
      PUBLIC_PROJECT_ID,
      "public-run",
      input.brandName,
      input.domain,
      competitors,
      demoPrompts.slice(0, MAX_PUBLIC_PROMPTS).map((p) => ({ text: p.text }))
    );
    const authorityOpportunities = generateDemoAuthorityOpportunities(PUBLIC_PROJECT_ID, input.industry, competitors);
    return {
      liveData: false,
      dataMode: "demo",
      providers,
      visibilityResults: visibilityResults.map((r) => ({
        engine: r.engine,
        prompt_text: r.prompt_text,
        brand_mentioned: r.brand_mentioned,
        brand_cited: r.brand_cited,
        source_domains: r.source_domains,
      })),
      visibilityMetrics: calculateVisibilityMetrics(visibilityResults),
      authorityOpportunities: authorityOpportunities.slice(0, 8).map((o) => ({
        type: o.type,
        target_site: o.target_site,
        pitch_angle: o.pitch_angle,
        estimated_impact: o.estimated_impact,
      })),
      coverageGaps: [],
      coverageItems: [],
      backlinkCount: 0,
      backlinksAvailable: false,
      serpPresence: false,
    };
  }

  // Prefer LLM-generated, brand/industry-aware prompts (real buyer intent) so a
  // strong brand shows real visibility instead of fake zeros from generic
  // local-service templates. Falls back to the improved templates if the LLM
  // call fails or returns nothing.
  let candidatePrompts: Array<{ text: string; category?: string; priority?: number }> = [];
  if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    try {
      candidatePrompts = await generatePromptUniverse(
        PUBLIC_PROJECT_ID,
        input.brandName,
        input.industry,
        location,
        competitors,
        `${input.industry} buyers`,
        [input.industry],
        14
      );
    } catch {
      candidatePrompts = [];
    }
  }
  if (candidatePrompts.length === 0) {
    candidatePrompts = generateTemplatePrompts(
      PUBLIC_PROJECT_ID,
      input.brandName,
      input.industry,
      location,
      competitors,
      [input.industry]
    );
  }
  const templatePrompts = candidatePrompts
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, MAX_PUBLIC_PROMPTS);

  const engines = selectPublicEngines();
  const runId = `public-${Date.now()}`;

  const visibilityScan = await runVisibilityScan({
    projectId: PUBLIC_PROJECT_ID,
    runId,
    brandName: input.brandName,
    brandDomain: input.domain,
    competitors,
    location,
    prompts: templatePrompts.map((p) => ({ text: p.text, priority: p.priority })),
    engines,
    maxPrompts: MAX_PUBLIC_PROMPTS,
  });

  const buyerPrompts = templatePrompts.map((p) => p.text);
  const [authorityOpps, coverage, backlinks, serpCheck] = await Promise.all([
    findAuthorityOpportunities(
      PUBLIC_PROJECT_ID,
      input.brandName,
      input.domain,
      input.industry,
      competitors,
      buyerPrompts
    ),
    checkPlatformCoverage(PUBLIC_PROJECT_ID, input.brandName, input.domain, competitors),
    getBacklinksFree(input.domain, 15),
    searchGoogleOrganicRouter(
      location && location.trim().toLowerCase() !== "united states"
        ? `best ${input.industry} ${location}`
        : `best ${input.industry}`,
      location,
      input.domain,
      competitors
    ),
  ]);

  const domainToken = input.domain.replace(/^www\./, "").split(".")[0].toLowerCase();
  const serpPresence =
    serpCheck.success &&
    Boolean(
      serpCheck.data?.brandInResults ||
        serpCheck.data?.organicResults.some((r) => r.url.toLowerCase().includes(domainToken))
    );

  const coverageGaps = coverage
    .filter((c) => !c.is_present && c.surface !== "other")
    .map((c) => c.platform_name)
    .slice(0, 8);

  return {
    liveData: true,
    dataMode: "measured",
    providers,
    visibilityResults: visibilityScan.map((r) => ({
      engine: r.engine,
      prompt_text: r.prompt_text,
      brand_mentioned: r.brand_mentioned,
      brand_cited: r.brand_cited,
      source_domains: r.source_domains,
    })),
    visibilityMetrics: calculateVisibilityMetrics(visibilityScan),
    authorityOpportunities: authorityOpps.slice(0, 8).map((o) => ({
      type: o.type,
      target_site: o.target_site,
      pitch_angle: o.pitch_angle || "Earn a mention on this high-authority surface",
      estimated_impact: o.estimated_impact ?? 50,
    })),
    coverageGaps,
    coverageItems: coverage.map((c) => ({
      platform_name: c.platform_name,
      is_present: c.is_present,
      competitor_present: c.competitor_present,
      surface: c.surface,
    })),
    backlinkCount: backlinks.success ? (backlinks.data?.length ?? 0) : 0,
    backlinksAvailable: backlinks.success,
    serpPresence,
  };
}

export function mergeIntelligenceIntoScore(
  technicalFindings: TechnicalAuditFinding[],
  intelligence: PublicAuditIntelligence,
  baseScore: {
    omnipresence_score: number;
    ai_visibility: number;
    search_visibility: number;
    technical_readiness: number;
  }
) {
  if (intelligence.dataMode === "demo") return baseScore;

  const mentionBoost = intelligence.visibilityMetrics.mentionRate * 15;
  const citationBoost = intelligence.visibilityMetrics.citationRate * 10;
  const serpBoost = intelligence.serpPresence ? 5 : 0;
  const backlinkBoost = Math.min(intelligence.backlinkCount * 0.5, 8);
  const gapPenalty = Math.min(intelligence.coverageGaps.length * 1.5, 12);

  return {
    omnipresence_score: Math.min(
      100,
      Math.max(0, baseScore.omnipresence_score + mentionBoost + serpBoost + backlinkBoost - gapPenalty)
    ),
    ai_visibility: Math.min(100, baseScore.ai_visibility + mentionBoost + citationBoost),
    search_visibility: Math.min(100, baseScore.search_visibility + serpBoost + backlinkBoost),
    technical_readiness: baseScore.technical_readiness,
  };
}
