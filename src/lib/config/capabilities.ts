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
  | "clearbit";

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  configured: boolean;
  required: boolean;
  category: "ai" | "data" | "infra" | "social" | "oauth";
}

export const V2_VERSION = "0.4.0";

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
    (hasEnv("DATAFORSEO_LOGIN") && hasEnv("DATAFORSEO_PASSWORD"))
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
    },
  };
}
