/**
 * OmniPresence Engine v2 — capability registry.
 * All engines are enabled by default; live data is used whenever credentials exist.
 */

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google_genai"
  | "dataforseo"
  | "serper"
  | "brave"
  | "perplexity"
  | "firecrawl"
  | "inngest"
  | "resend"
  | "ayrshare"
  | "buffer"
  | "omnidata"
  | "indexnow"
  | "google_oauth"
  | "bing_oauth"
  | "supabase"
  | "posthog"
  | "stripe"
  | "clearbit"
  | "searxng"
  | "ollama"
  | "youtube"
  | "clarity"
  | "languagetool"
  | "google_kg"
  | "posthog_query";

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  configured: boolean;
  required: boolean;
  category: "ai" | "data" | "infra" | "social" | "oauth";
}

export const V2_VERSION = "0.5.0";

/** All execution engines are enabled — paywalls deferred. */
export const ENGINES_ENABLED = {
  brandEntity: true,
  visibilityTracking: true,
  technicalGates: true,
  schemaDeployment: true,
  contentDomination: true,
  distribution: true,
  authorityTargeting: true,
  attributionProof: true,
  opsConsole: true,
  continuousAgents: true,
} as const;

function hasEnv(key: string): boolean {
  const v = process.env[key];
  return Boolean(v && v.length > 0 && !v.startsWith("your-"));
}

/**
 * Paid third-party vendors. In Zero-Paid-Keys mode (Wave L) the provider router
 * (Wave H) refuses these adapters so the platform proves it runs the full loop
 * on sovereign/self-hosted engines only.
 */
export const PAID_PROVIDERS: ProviderId[] = [
  "openai",
  "anthropic",
  "google_genai",
  "dataforseo",
  "serper",
  "perplexity",
  "firecrawl",
  "resend",
  "ayrshare",
  "buffer",
  "clearbit",
];

/** True when the operator has opted into a fully sovereign, no-paid-keys run. */
export function isZeroPaidKeysMode(): boolean {
  return process.env.ZERO_PAID_KEYS === "true";
}

export function isPaidProvider(id: ProviderId): boolean {
  return PAID_PROVIDERS.includes(id);
}

export function getProviderStatuses(): ProviderStatus[] {
  return [
    { id: "supabase", name: "Supabase", configured: hasEnv("NEXT_PUBLIC_SUPABASE_URL") && hasEnv("SUPABASE_SERVICE_ROLE_KEY"), required: true, category: "infra" },
    { id: "openai", name: "OpenAI", configured: hasEnv("OPENAI_API_KEY"), required: false, category: "ai" },
    { id: "anthropic", name: "Anthropic", configured: hasEnv("ANTHROPIC_API_KEY"), required: false, category: "ai" },
    { id: "google_genai", name: "Google GenAI", configured: hasEnv("GOOGLE_GENERATIVE_AI_API_KEY"), required: false, category: "ai" },
    { id: "dataforseo", name: "DataForSEO (optional)", configured: hasEnv("DATAFORSEO_LOGIN") && hasEnv("DATAFORSEO_PASSWORD"), required: false, category: "data" },
    { id: "serper", name: "Serper", configured: hasEnv("SERPER_API_KEY"), required: false, category: "data" },
    { id: "brave", name: "Brave Search (free tier)", configured: hasEnv("BRAVE_SEARCH_API_KEY"), required: false, category: "data" },
    { id: "omnidata", name: "OmniData Engine (self-hosted)", configured: hasEnv("OMNIDATA_BASE_URL") && hasEnv("OMNIDATA_API_KEY"), required: false, category: "data" },
    { id: "perplexity", name: "Perplexity", configured: hasEnv("PERPLEXITY_API_KEY"), required: false, category: "data" },
    { id: "firecrawl", name: "Firecrawl", configured: hasEnv("FIRECRAWL_API_KEY"), required: false, category: "data" },
    { id: "inngest", name: "Inngest", configured: hasEnv("INNGEST_EVENT_KEY"), required: false, category: "infra" },
    { id: "resend", name: "Resend", configured: hasEnv("RESEND_API_KEY"), required: false, category: "infra" },
    { id: "ayrshare", name: "Ayrshare", configured: hasEnv("AYRSHARE_API_KEY"), required: false, category: "social" },
    { id: "buffer", name: "Buffer", configured: hasEnv("BUFFER_ACCESS_TOKEN"), required: false, category: "social" },
    { id: "indexnow", name: "IndexNow", configured: hasEnv("INDEXNOW_KEY"), required: false, category: "data" },
    { id: "google_oauth", name: "Google OAuth", configured: hasEnv("GOOGLE_CLIENT_ID") && hasEnv("GOOGLE_CLIENT_SECRET"), required: false, category: "oauth" },
    { id: "bing_oauth", name: "Bing OAuth", configured: hasEnv("BING_CLIENT_ID") && hasEnv("BING_CLIENT_SECRET"), required: false, category: "oauth" },
    { id: "posthog", name: "PostHog", configured: hasEnv("NEXT_PUBLIC_POSTHOG_KEY"), required: false, category: "infra" },
    {
      id: "stripe",
      name: "Stripe",
      configured: hasEnv("STRIPE_SECRET_KEY") && hasEnv("STRIPE_WEBHOOK_SECRET"),
      required: false,
      category: "infra",
    },
    { id: "clearbit", name: "Clearbit Reveal", configured: hasEnv("CLEARBIT_REVEAL_KEY"), required: false, category: "data" },
    // 100X free / keyless data moat (all optional, graceful fallback).
    { id: "searxng", name: "SearXNG (keyless SERP)", configured: hasEnv("SEARXNG_URL"), required: false, category: "data" },
    { id: "ollama", name: "Ollama (open-model AI)", configured: hasEnv("OLLAMA_BASE_URL"), required: false, category: "ai" },
    { id: "youtube", name: "YouTube Data API", configured: hasEnv("YOUTUBE_API_KEY"), required: false, category: "data" },
    { id: "clarity", name: "Microsoft Clarity", configured: hasEnv("CLARITY_API_TOKEN"), required: false, category: "data" },
    { id: "languagetool", name: "LanguageTool (self-host)", configured: hasEnv("LANGUAGETOOL_URL"), required: false, category: "data" },
    { id: "google_kg", name: "Google Knowledge Graph", configured: hasEnv("GOOGLE_KG_API_KEY"), required: false, category: "data" },
    { id: "posthog_query", name: "PostHog Query API", configured: hasEnv("POSTHOG_API_KEY") && hasEnv("POSTHOG_PROJECT_ID"), required: false, category: "data" },
  ];
}

export function hasAnyLiveDataProvider(): boolean {
  return hasCitationTrackingCapability();
}

export function hasSerpCapability(): boolean {
  return (
    hasEnv("SERPER_API_KEY") ||
    hasEnv("BRAVE_SEARCH_API_KEY") ||
    (hasEnv("OMNIDATA_BASE_URL") && hasEnv("OMNIDATA_API_KEY")) ||
    (hasEnv("DATAFORSEO_LOGIN") && hasEnv("DATAFORSEO_PASSWORD")) ||
    // Firecrawl /v1/search returns live Google organic results — a real,
    // working SERP backend whenever a Firecrawl key is configured.
    hasEnv("FIRECRAWL_API_KEY")
  );
}

/** Keyless/self-hosted SERP only (no paid vendor) — what survives Zero-Paid-Keys mode. */
export function hasKeylessSerpCapability(): boolean {
  return (
    hasEnv("SEARXNG_URL") ||
    hasEnv("SEARXNG_URLS") ||
    (hasEnv("OMNIDATA_BASE_URL") && hasEnv("OMNIDATA_API_KEY"))
  );
}

/** DIY citation stack — replaces DataForSEO LLM Mentions as the default path. */
export function hasCitationTrackingCapability(): boolean {
  return (
    hasEnv("OPENAI_API_KEY") ||
    hasEnv("ANTHROPIC_API_KEY") ||
    hasEnv("GOOGLE_GENERATIVE_AI_API_KEY") ||
    hasEnv("PERPLEXITY_API_KEY") ||
    hasSerpCapability()
  );
}

export function hasLLMMentionsCapability(): boolean {
  return hasEnv("DATAFORSEO_LOGIN") && hasEnv("DATAFORSEO_PASSWORD");
}

/** A direct generative-engine key (ChatGPT/Claude/Gemini) for true AI-answer probes. */
export function hasDirectLLMCapability(): boolean {
  return (
    hasEnv("OPENAI_API_KEY") ||
    hasEnv("ANTHROPIC_API_KEY") ||
    hasEnv("GOOGLE_GENERATIVE_AI_API_KEY")
  );
}

/** Which generative engines are live right now (for readiness/UI). */
export function activeAIEngines(): string[] {
  const out: string[] = [];
  if (hasEnv("OPENAI_API_KEY")) out.push("ChatGPT");
  if (hasEnv("ANTHROPIC_API_KEY")) out.push("Claude");
  if (hasEnv("GOOGLE_GENERATIVE_AI_API_KEY")) out.push("Gemini");
  if (hasEnv("PERPLEXITY_API_KEY")) out.push("Perplexity");
  return out;
}

export function preferLiveData(): boolean {
  if (process.env.FORCE_DEMO_MODE === "true") return false;
  return hasAnyLiveDataProvider();
}

export function getCapabilitiesSummary() {
  const providers = getProviderStatuses();
  const configured = providers.filter((p) => p.configured).length;
  const activeSerp =
    hasEnv("OMNIDATA_BASE_URL") && hasEnv("OMNIDATA_API_KEY") ? "omnidata" :
    hasEnv("SERPER_API_KEY") ? "serper" :
    hasEnv("BRAVE_SEARCH_API_KEY") ? "brave" :
    hasLLMMentionsCapability() ? "dataforseo" :
    hasEnv("FIRECRAWL_API_KEY") ? "firecrawl" :
    null;

  return {
    version: V2_VERSION,
    engines: ENGINES_ENABLED,
    liveData: preferLiveData(),
    providers,
    configuredCount: configured,
    totalProviders: providers.length,
    llmMentions: hasCitationTrackingCapability(),
    citationTracking: hasCitationTrackingCapability(),
    dataForSeoFallback: hasLLMMentionsCapability(),
    serpCapability: hasSerpCapability(),
    activeSerpProvider: activeSerp,
    diyStack: {
      serp: activeSerp,
      llmDirect: hasEnv("OPENAI_API_KEY") || hasEnv("ANTHROPIC_API_KEY") || hasEnv("GOOGLE_GENERATIVE_AI_API_KEY"),
      perplexity: hasEnv("PERPLEXITY_API_KEY"),
      firecrawl: hasEnv("FIRECRAWL_API_KEY"),
      omnidata: hasEnv("OMNIDATA_BASE_URL"),
      dataForSeoOptional: hasLLMMentionsCapability(),
      // Phase 2 - optional grounded AI UI-surface capture (Profound-style).
      aiUiCapture: process.env.ENABLE_AI_UI_CAPTURE === "true" && hasEnv("AI_UI_CAPTURE_URL"),
    },
    // Free, keyless-first AEO signals (always available, rate-limited).
    freeSignals: {
      pageSpeed: true,
      trancoAuthority: true,
      aeoReadiness: true,
      // Phase 11 - the Free Data Moat (all keyless / open-source).
      googleTrends: true,
      techStackDetection: true,
      popularityIndex: true,
      authorityRating: true,
      wikipediaEntity: true,
      hackerNews: true,
      domainAge: true,
      commonCrawlBacklinks: true,
      // Phase 12 - Index Expansion & Calibration.
      keywordVolumeCalibration: true, // Trends extrapolation + buckets + confidence
      globalDomainRank: true, // rank.to keyless aggregated-traffic rank
      competitiveMatrix: true, // unified popularity + authority + tech + CWV
      realUserCwv: true, // CrUX field data (reliable with PAGESPEED_API_KEY)
    },
    // 100X Free Data Moat — keyless-always-on vs token/self-host gated.
    freeDataMoat100x: {
      // Keyless, always on:
      gdeltNews: true,
      googleNewsRss: true,
      multiSourceAutocomplete: true,
      keywordUniverse: true,
      editorialQa: true, // readability/keyphrases/language (LanguageTool optional)
      htmlValidity: true, // W3C Nu checker
      accessibilityAudit: true, // WCAG heuristics
      richResultsCheck: true,
      osmLocal: true, // Nominatim + Overpass
      mentionFirehose: true, // SE/GitHub/Mastodon/Bluesky/Wikipedia keyless
      wikidataDbpedia: true,
      lookerStudioConnector: true,
      // Token / self-host gated (graceful fallback when unset):
      clarityBehavior: hasEnv("CLARITY_API_TOKEN"),
      videoSeo: hasEnv("YOUTUBE_API_KEY"),
      cwvHistory: hasEnv("CRUX_API_KEY") || hasEnv("PAGESPEED_API_KEY"),
      searxngSerp: hasEnv("SEARXNG_URL"),
      ollamaAi: hasEnv("OLLAMA_BASE_URL"),
      posthogAnalytics: hasEnv("POSTHOG_API_KEY") && hasEnv("POSTHOG_PROJECT_ID"),
      languageToolSelfHost: hasEnv("LANGUAGETOOL_URL"),
      googleKnowledgeGraph: hasEnv("GOOGLE_KG_API_KEY"),
      productHunt: hasEnv("PRODUCTHUNT_TOKEN"),
      githubHigherRate: hasEnv("GITHUB_TOKEN"),
    },
  };
}
