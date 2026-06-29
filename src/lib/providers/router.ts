/**
 * Unified provider router (Phase 23 / manifest v24, Wave H).
 *
 * A single capability port — `serp`, `crawl`, `backlinks`, `generate`, `email`,
 * `social`, `enrich` — where each capability has a ranked list of adapters.
 * Self-hosted/free adapters are tried first; paid vendors are optional upgrades.
 * Every adapter carries health, cost, confidence and freshness so routing is an
 * explicit, observable decision (and so the Zero-Paid-Keys audit in Wave L can
 * prove the full loop runs with no paid keys).
 *
 * SERP is fully executable today (it reuses the existing provider clients);
 * the other capabilities are registered as a ranked, health-aware catalog that
 * Waves I/J/K attach concrete run-functions to. Filtering, ordering, failover,
 * health tracking and the ZERO_PAID_KEYS gate are shared by all of them.
 */
import {
  searchGoogleOrganic as searchGoogleOrganicDataForSEO,
  isOmniDataActive,
} from "@/lib/providers/dataforseo";
import { searchGoogleOrganicBrave } from "@/lib/providers/brave-search";
import { searchGoogleOrganicSerper } from "@/lib/providers/serper";
import { searchGoogleOrganicSearxng, hasSearxngCapability } from "@/lib/providers/searxng";
import { searchGoogleOrganicFirecrawl, hasFirecrawlCapability } from "@/lib/providers/firecrawl";
import { isZeroPaidKeysMode } from "@/lib/config/capabilities";
import type { ProviderResult, SERPResult } from "./types";

export type Capability = "serp" | "crawl" | "backlinks" | "generate" | "email" | "social" | "enrich";
export type Freshness = "live" | "recent" | "cached" | "none";

export interface Adapter<TArgs extends unknown[] = unknown[], TData = unknown> {
  id: string;
  capability: Capability;
  /** Paid third-party vendor — excluded entirely in Zero-Paid-Keys mode. */
  paid: boolean;
  /** Self-hosted / keyless engine — preferred first. */
  selfHosted: boolean;
  /** Confidence in the result quality, 0..1. */
  confidence: number;
  freshness: Freshness;
  /** Rough USD cost per call (0 = free/self-hosted). */
  costPerCall: number;
  enabled: () => boolean;
  run?: (...args: TArgs) => Promise<ProviderResult<TData>>;
}

interface Health {
  failures: number;
  lastError?: string;
  lastOkAt?: number;
}

const health = new Map<string, Health>();

function getHealth(id: string): Health {
  let h = health.get(id);
  if (!h) {
    h = { failures: 0 };
    health.set(id, h);
  }
  return h;
}

function hasEnv(key: string): boolean {
  const v = process.env[key];
  return Boolean(v && v.length > 0 && !v.startsWith("your-"));
}

function hasDataForSeoBackend(): boolean {
  return isOmniDataActive() || (hasEnv("DATAFORSEO_LOGIN") && hasEnv("DATAFORSEO_PASSWORD"));
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const serpAdapters: Adapter<[string, string, string, string[]], SERPResult>[] = [
  {
    id: "serper",
    capability: "serp",
    paid: true,
    selfHosted: false,
    confidence: 0.95,
    freshness: "live",
    costPerCall: 0.001,
    enabled: () => hasEnv("SERPER_API_KEY"),
    run: (kw, loc, brand, comp) => searchGoogleOrganicSerper(kw, loc, brand, comp),
  },
  {
    id: "brave",
    capability: "serp",
    paid: false,
    selfHosted: false,
    confidence: 0.85,
    freshness: "live",
    costPerCall: 0,
    enabled: () => hasEnv("BRAVE_SEARCH_API_KEY"),
    run: (kw, loc, brand, comp) => searchGoogleOrganicBrave(kw, loc, brand, comp),
  },
  {
    id: "searxng",
    capability: "serp",
    paid: false,
    selfHosted: true,
    confidence: 0.8,
    freshness: "live",
    costPerCall: 0,
    enabled: () => hasSearxngCapability(),
    run: (kw, loc, brand, comp) => searchGoogleOrganicSearxng(kw, loc, brand, comp),
  },
  {
    id: "omnidata",
    capability: "serp",
    paid: false,
    selfHosted: true,
    confidence: 0.85,
    freshness: "live",
    costPerCall: 0,
    enabled: () => isOmniDataActive(),
    run: (kw, loc, brand, comp) => searchGoogleOrganicDataForSEO(kw, loc, brand, comp),
  },
  {
    id: "dataforseo",
    capability: "serp",
    paid: true,
    selfHosted: false,
    confidence: 0.95,
    freshness: "live",
    costPerCall: 0.0006,
    enabled: () => !isOmniDataActive() && hasEnv("DATAFORSEO_LOGIN") && hasEnv("DATAFORSEO_PASSWORD"),
    run: (kw, loc, brand, comp) => searchGoogleOrganicDataForSEO(kw, loc, brand, comp),
  },
  {
    id: "firecrawl",
    capability: "serp",
    paid: true,
    selfHosted: false,
    confidence: 0.75,
    freshness: "live",
    costPerCall: 0.002,
    enabled: () => hasFirecrawlCapability(),
    run: (kw, loc, brand, comp) => searchGoogleOrganicFirecrawl(kw, loc, brand, comp),
  },
];

// Catalog-only adapters (run-functions attached by Waves I/J/K). They make the
// router's ranking + Zero-Paid-Keys audit honest across every capability.
const catalogAdapters: Adapter[] = [
  { id: "omnidata-crawl", capability: "crawl", paid: false, selfHosted: true, confidence: 0.9, freshness: "live", costPerCall: 0, enabled: () => isOmniDataActive() },
  { id: "playwright-crawl", capability: "crawl", paid: false, selfHosted: true, confidence: 0.85, freshness: "live", costPerCall: 0, enabled: () => true },
  { id: "firecrawl-crawl", capability: "crawl", paid: true, selfHosted: false, confidence: 0.8, freshness: "live", costPerCall: 0.002, enabled: () => hasFirecrawlCapability() },

  { id: "commoncrawl-webgraph", capability: "backlinks", paid: false, selfHosted: true, confidence: 0.7, freshness: "recent", costPerCall: 0, enabled: () => true },
  { id: "dataforseo-backlinks", capability: "backlinks", paid: true, selfHosted: false, confidence: 0.95, freshness: "recent", costPerCall: 0.02, enabled: () => hasDataForSeoBackend() },

  { id: "ollama-generate", capability: "generate", paid: false, selfHosted: true, confidence: 0.75, freshness: "live", costPerCall: 0, enabled: () => hasEnv("OLLAMA_BASE_URL") },
  { id: "openai-generate", capability: "generate", paid: true, selfHosted: false, confidence: 0.95, freshness: "live", costPerCall: 0.01, enabled: () => hasEnv("OPENAI_API_KEY") },
  { id: "anthropic-generate", capability: "generate", paid: true, selfHosted: false, confidence: 0.95, freshness: "live", costPerCall: 0.01, enabled: () => hasEnv("ANTHROPIC_API_KEY") },

  { id: "smtp-email", capability: "email", paid: false, selfHosted: true, confidence: 0.8, freshness: "live", costPerCall: 0, enabled: () => hasEnv("SMTP_HOST") },
  { id: "resend-email", capability: "email", paid: true, selfHosted: false, confidence: 0.9, freshness: "live", costPerCall: 0.0004, enabled: () => hasEnv("RESEND_API_KEY") },

  { id: "direct-social", capability: "social", paid: false, selfHosted: true, confidence: 0.75, freshness: "live", costPerCall: 0, enabled: () => hasEnv("X_API_KEY") || hasEnv("LINKEDIN_ACCESS_TOKEN") },
  { id: "buffer-social", capability: "social", paid: true, selfHosted: false, confidence: 0.85, freshness: "live", costPerCall: 0, enabled: () => hasEnv("BUFFER_ACCESS_TOKEN") },
  { id: "ayrshare-social", capability: "social", paid: true, selfHosted: false, confidence: 0.85, freshness: "live", costPerCall: 0, enabled: () => hasEnv("AYRSHARE_API_KEY") },

  { id: "ip-asn-enrich", capability: "enrich", paid: false, selfHosted: true, confidence: 0.5, freshness: "recent", costPerCall: 0, enabled: () => true },
  { id: "clearbit-enrich", capability: "enrich", paid: true, selfHosted: false, confidence: 0.9, freshness: "recent", costPerCall: 0.01, enabled: () => hasEnv("CLEARBIT_REVEAL_KEY") },
];

const registry: Record<Capability, Adapter[]> = {
  serp: serpAdapters as unknown as Adapter[],
  crawl: catalogAdapters.filter((a) => a.capability === "crawl"),
  backlinks: catalogAdapters.filter((a) => a.capability === "backlinks"),
  generate: catalogAdapters.filter((a) => a.capability === "generate"),
  email: catalogAdapters.filter((a) => a.capability === "email"),
  social: catalogAdapters.filter((a) => a.capability === "social"),
  enrich: catalogAdapters.filter((a) => a.capability === "enrich"),
};

/** Register a concrete run-function for a catalog adapter (used by later waves). */
export function attachRunner<TArgs extends unknown[], TData>(
  capability: Capability,
  adapterId: string,
  run: (...args: TArgs) => Promise<ProviderResult<TData>>
): boolean {
  const adapter = registry[capability].find((a) => a.id === adapterId);
  if (!adapter) return false;
  adapter.run = run as Adapter["run"];
  return true;
}

/**
 * Ranked, currently-usable adapters for a capability. Order: self-hosted/free
 * first, then higher confidence, then healthier (fewer recent failures), then
 * cheaper. Paid adapters are dropped entirely in Zero-Paid-Keys mode.
 */
export function rankedAdapters(capability: Capability): Adapter[] {
  const zeroPaid = isZeroPaidKeysMode();
  return registry[capability]
    .filter((a) => a.enabled() && !(zeroPaid && a.paid))
    .sort((a, b) => {
      if (a.paid !== b.paid) return a.paid ? 1 : -1;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      const fa = getHealth(a.id).failures;
      const fb = getHealth(b.id).failures;
      if (fa !== fb) return fa - fb;
      return a.costPerCall - b.costPerCall;
    });
}

export interface RouteOutcome<TData> extends ProviderResult<TData> {
  provider?: string;
  /** Adapters attempted, in order, with their outcome. */
  trail?: Array<{ id: string; ok: boolean; error?: string }>;
}

/**
 * Execute a capability with auto-failover across ranked adapters. Records health
 * so a flaky provider is naturally deprioritized on subsequent calls.
 */
export async function route<TArgs extends unknown[], TData>(
  capability: Capability,
  ...args: TArgs
): Promise<RouteOutcome<TData>> {
  const adapters = rankedAdapters(capability).filter((a) => typeof a.run === "function");
  const trail: Array<{ id: string; ok: boolean; error?: string }> = [];
  let lastError = `No ${capability} provider configured`;

  for (const adapter of adapters) {
    try {
      const result = (await adapter.run!(...(args as unknown[]))) as ProviderResult<TData>;
      if (result.success && result.data !== undefined) {
        const h = getHealth(adapter.id);
        h.failures = 0;
        h.lastOkAt = Date.now();
        trail.push({ id: adapter.id, ok: true });
        return { ...result, provider: adapter.id, trail };
      }
      lastError = result.error || lastError;
      const h = getHealth(adapter.id);
      h.failures += 1;
      h.lastError = lastError;
      trail.push({ id: adapter.id, ok: false, error: lastError });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const h = getHealth(adapter.id);
      h.failures += 1;
      h.lastError = lastError;
      trail.push({ id: adapter.id, ok: false, error: lastError });
    }
  }

  return { success: false, error: lastError, trail };
}

/** SERP-specific entry point with the legacy signature, routed + failover-aware. */
export function routeSerp(
  keyword: string,
  location = "United States",
  brandDomain: string,
  competitors: string[]
): Promise<RouteOutcome<SERPResult>> {
  return route<[string, string, string, string[]], SERPResult>(
    "serp",
    keyword,
    location,
    brandDomain,
    competitors
  );
}

export interface AdapterStatus {
  id: string;
  capability: Capability;
  paid: boolean;
  selfHosted: boolean;
  enabled: boolean;
  usableNow: boolean;
  confidence: number;
  freshness: Freshness;
  costPerCall: number;
  failures: number;
}

/** Diagnostic catalog of every adapter and whether it's usable right now. */
export function describeProviders(): AdapterStatus[] {
  const zeroPaid = isZeroPaidKeysMode();
  const all: Adapter[] = (Object.keys(registry) as Capability[]).flatMap((c) => registry[c]);
  return all.map((a) => ({
    id: a.id,
    capability: a.capability,
    paid: a.paid,
    selfHosted: a.selfHosted,
    enabled: a.enabled(),
    usableNow: a.enabled() && !(zeroPaid && a.paid),
    confidence: a.confidence,
    freshness: a.freshness,
    costPerCall: a.costPerCall,
    failures: getHealth(a.id).failures,
  }));
}

/**
 * Zero-Paid-Keys readiness: which capabilities still have a usable sovereign
 * adapter when all paid vendors are removed. Powers the Wave L audit gate.
 */
export function zeroPaidKeysReadiness(): {
  ready: boolean;
  capabilities: Array<{ capability: Capability; sovereignReady: boolean; adapters: string[] }>;
} {
  const caps = Object.keys(registry) as Capability[];
  const capabilities = caps.map((capability) => {
    const sovereign = registry[capability].filter((a) => !a.paid && a.enabled());
    return {
      capability,
      sovereignReady: sovereign.length > 0,
      adapters: sovereign.map((a) => a.id),
    };
  });
  return { ready: capabilities.every((c) => c.sovereignReady), capabilities };
}
