/**
 * OmniPresence Engine v2 — capability registry.
 * All engines are enabled by default; live data is used whenever credentials exist.
 */

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google_genai"
  | "dataforseo"
  | "perplexity"
  | "firecrawl"
  | "inngest"
  | "resend"
  | "ayrshare"
  | "buffer"
  | "indexnow"
  | "google_oauth"
  | "bing_oauth"
  | "supabase"
  | "posthog";

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  configured: boolean;
  required: boolean;
  category: "ai" | "data" | "infra" | "social" | "oauth";
}

export const V2_VERSION = "0.2.0";

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
    { id: "dataforseo", name: "DataForSEO", configured: hasEnv("DATAFORSEO_LOGIN") && hasEnv("DATAFORSEO_PASSWORD"), required: false, category: "data" },
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
  ];
}

export function hasAnyLiveDataProvider(): boolean {
  return getProviderStatuses().some(
    (p) => p.configured && ["openai", "dataforseo", "perplexity"].includes(p.id)
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
  return {
    version: V2_VERSION,
    engines: ENGINES_ENABLED,
    liveData: preferLiveData(),
    providers,
    configuredCount: configured,
    totalProviders: providers.length,
    llmMentions: hasLLMMentionsCapability(),
  };
}
