import { preferLiveData, hasSerpCapability, getCapabilitiesSummary } from "@/lib/config/capabilities";
import { generatePromptUniverse, generateTemplatePrompts } from "@/lib/engines/prompt-generator";
import { runVisibilityScan, calculateVisibilityMetrics } from "@/lib/engines/visibility-scanner";
import { findAuthorityOpportunities } from "@/lib/engines/authority-finder";
import { checkPlatformCoverage } from "@/lib/engines/coverage-checker";
import { getBacklinksFree } from "@/lib/providers/backlinks-free";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import { sameRegistrableDomain } from "@/lib/engines/brand-matcher";
import type { VisibilityEngine, VisibilityResult } from "@/types/database";

const PUBLIC_PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const MAX_PUBLIC_PROMPTS = 5;

function selectPublicEngines(): VisibilityEngine[] {
  const engines: VisibilityEngine[] = [];
  if (process.env.PERPLEXITY_API_KEY) engines.push("perplexity");
  if (hasSerpCapability()) engines.push("google_organic", "google_ai_overview");
  // Probe every configured generative engine — a real AI-visibility audit should
  // reflect ChatGPT, Claude, AND Gemini, not just one. Bounded by the cost guard.
  if (process.env.OPENAI_API_KEY) engines.push("chatgpt");
  if (process.env.ANTHROPIC_API_KEY) engines.push("claude");
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) engines.push("gemini");
  return engines.length ? engines : ["google_organic"];
}

export interface PublicAuditIntelligence {
  liveData: boolean;
  dataMode: "measured" | "demo" | "unavailable";
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
    is_optimized: boolean;
    competitor_present: boolean;
    surface: string;
    /** Real provenance from coverage-checker: "measured" when the SERP probe ran,
     *  "unavailable" when the provider was unreachable (must NOT score as absent). */
    data_quality: "measured" | "unavailable";
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
    // No live data provider is configured. This is a PROSPECT-FACING audit, so
    // we never fabricate visibility numbers about someone's real brand — that
    // would be exactly the "fake results" this platform refuses to ship. We
    // return an honest "AI visibility unavailable" state; the public route still
    // renders real keyless signals (technical audit, domain authority, PageSpeed)
    // and a clear "connect a provider" message.
    return {
      liveData: false,
      dataMode: "unavailable",
      providers,
      visibilityResults: [],
      visibilityMetrics: calculateVisibilityMetrics([]),
      authorityOpportunities: [],
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

  const { results: visibilityScan } = await runVisibilityScan({
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

  // SERP presence must be consistent with the organic probes we actually show.
  // A real brand that surfaces on any buyer-intent organic/AI-Overview query has
  // search presence — reporting "false" because its own domain didn't rank for a
  // single hyper-competitive "best {industry}" listicle query reads as a fake
  // miss. Combine the scanned organic hits with a proper registrable-domain match
  // on the competitive check (no fragile substring matching).
  const organicBrandHit = visibilityScan.some(
    (r) =>
      (r.engine === "google_organic" || r.engine === "google_ai_overview") &&
      r.brand_mentioned
  );
  const serpPresence =
    organicBrandHit ||
    (serpCheck.success &&
      Boolean(
        serpCheck.data?.brandInResults ||
          serpCheck.data?.organicResults.some((r) =>
            sameRegistrableDomain(r.url, input.domain)
          )
      ));

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
      is_optimized: c.is_optimized,
      competitor_present: c.competitor_present,
      surface: c.surface,
      data_quality: (c.data_quality === "measured" ? "measured" : "unavailable") as "measured" | "unavailable",
    })),
    backlinkCount: backlinks.success ? (backlinks.data?.length ?? 0) : 0,
    backlinksAvailable: backlinks.success,
    serpPresence,
  };
}

// NOTE: A prior `mergeIntelligenceIntoScore` booster was removed — it re-added
// mention/citation/SERP/coverage signals that `calculateOmniPresenceScore`
// already accounts for, double-counting and inflating the public audit score
// relative to the in-app score. The public route now uses the rigorous scorer
// directly so both numbers share one honest methodology.

/** Empty intelligence when the public audit time budget is exceeded. */
export function emptyPublicAuditIntelligence(partial?: Partial<PublicAuditIntelligence>): PublicAuditIntelligence {
  const providers = getCapabilitiesSummary();
  const live = preferLiveData();
  return {
    liveData: live,
    dataMode: live ? "measured" : "unavailable",
    providers,
    visibilityResults: [],
    visibilityMetrics: calculateVisibilityMetrics([]),
    authorityOpportunities: [],
    coverageGaps: [],
    coverageItems: [],
    backlinkCount: 0,
    backlinksAvailable: false,
    serpPresence: false,
    ...partial,
  };
}

const PUBLIC_INTELLIGENCE_BUDGET_MS = 50_000;

export async function runPublicAuditIntelligenceWithBudget(
  input: Parameters<typeof runPublicAuditIntelligence>[0],
  budgetMs = PUBLIC_INTELLIGENCE_BUDGET_MS
): Promise<PublicAuditIntelligence> {
  let settled = false;
  const work = runPublicAuditIntelligence(input).then((r) => {
    settled = true;
    return r;
  });
  const timeout = new Promise<PublicAuditIntelligence>((resolve) => {
    setTimeout(() => {
      if (!settled) resolve(emptyPublicAuditIntelligence());
    }, budgetMs);
  });
  return Promise.race([work, timeout]);
}
