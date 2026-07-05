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
import { searchGoogleOrganicDuckDuckGo } from "@/lib/providers/duckduckgo-serp";
import { searchGoogleOrganicBrave } from "@/lib/providers/brave-search";
import { searchGoogleOrganicSerper } from "@/lib/providers/serper";
import { searchGoogleOrganicSearxng, hasSearxngCapability } from "@/lib/providers/searxng";
import { searchGoogleOrganicFirecrawl, hasFirecrawlCapability } from "@/lib/providers/firecrawl";
import { isZeroPaidKeysMode, isBenchmarkOnlyForced, type ProviderCategory } from "@/lib/config/capabilities";
import { isProviderCallAllowed } from "@/lib/providers/provider-call-cap";
import { withBreaker, CircuitOpenError, circuitStatus, type CircuitStatus } from "@/lib/providers/http";
import type { ProviderResult, SERPResult } from "./types";

export type Capability = "serp" | "crawl" | "backlinks" | "generate" | "email" | "social" | "enrich";
export type Freshness = "live" | "recent" | "cached" | "none";

export interface Adapter<TArgs extends unknown[] = unknown[], TData = unknown> {
  id: string;
  capability: Capability;
  /**
   * Engine role (Wave N1). Drives the cost firewall: `benchmark_only` adapters
   * are never used for customer-facing results; `fallback_only` is tried last;
   * `internal_reasoning` prefers local/self-hosted models.
   */
  category: ProviderCategory;
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

/** Effective engine role, applying the runtime BENCHMARK_ONLY_PROVIDERS override. */
export function effectiveCategory(a: Adapter): ProviderCategory {
  return isBenchmarkOnlyForced(a.id) ? "benchmark_only" : a.category;
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
    category: "fallback_only",
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
    category: "fallback_only",
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
    category: "surface_measurement",
    paid: false,
    selfHosted: true,
    confidence: 0.8,
    freshness: "live",
    costPerCall: 0,
    enabled: () => hasSearxngCapability(),
    run: (kw, loc, brand, comp) => searchGoogleOrganicSearxng(kw, loc, brand, comp),
  },
  {
    id: "duckduckgo",
    capability: "serp",
    category: "surface_measurement",
    paid: false,
    selfHosted: true,
    confidence: 0.9,
    freshness: "live",
    costPerCall: 0,
    enabled: () => true,
    run: (kw, loc, brand, comp) => searchGoogleOrganicDuckDuckGo(kw, loc, brand, comp),
  },
  {
    id: "omnidata",
    capability: "serp",
    category: "surface_measurement",
    paid: false,
    selfHosted: true,
    confidence: 0.85,
    freshness: "live",
    costPerCall: 0,
    enabled: () => isOmniDataActive(),
    run: (kw, loc, brand, comp) => searchGoogleOrganicDataForSEO(kw, loc, brand, comp),
  },
  {
    // Paid SEO vendor: last-resort fallback for customer results (sovereign first).
    id: "dataforseo",
    capability: "serp",
    category: "fallback_only",
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
    category: "fallback_only",
    paid: true,
    selfHosted: false,
    confidence: 0.75,
    freshness: "live",
    costPerCall: 0.002,
    enabled: () => hasFirecrawlCapability(),
    run: (kw, loc, brand, comp) => searchGoogleOrganicFirecrawl(kw, loc, brand, comp),
  },
];

// Capability catalog. Run-functions are attached by the dedicated modules:
//   crawl/backlinks/enrich/email/social -> capability-runners.ts,
//   generate -> generate-router.ts, serp -> serpAdapters (above).
// Every adapter listed here has an executable runner attached at wiring time;
// route() still defensively skips any without one. Catalog entries that had no
// real implementation (Buffer/Ayrshare social, standalone Clearbit enrich) were
// removed so adapterStatuses()/compareCapabilities() never advertise a dead path.
// Clearbit is still used as a paid upgrade INSIDE the ip-asn-enrich runner.
const catalogAdapters: Adapter[] = [
  { id: "playwright-crawl", capability: "crawl", category: "surface_measurement", paid: false, selfHosted: true, confidence: 0.85, freshness: "live", costPerCall: 0, enabled: () => true },
  { id: "firecrawl-crawl", capability: "crawl", category: "fallback_only", paid: true, selfHosted: false, confidence: 0.8, freshness: "live", costPerCall: 0.002, enabled: () => hasFirecrawlCapability() },

  { id: "commoncrawl-webgraph", capability: "backlinks", category: "surface_measurement", paid: false, selfHosted: true, confidence: 0.7, freshness: "recent", costPerCall: 0, enabled: () => true },
  { id: "dataforseo-backlinks", capability: "backlinks", category: "fallback_only", paid: true, selfHosted: false, confidence: 0.95, freshness: "recent", costPerCall: 0.02, enabled: () => hasDataForSeoBackend() },

  { id: "ollama-generate", capability: "generate", category: "internal_reasoning", paid: false, selfHosted: true, confidence: 0.75, freshness: "live", costPerCall: 0, enabled: () => hasEnv("OLLAMA_BASE_URL") },
  { id: "openai-generate", capability: "generate", category: "internal_reasoning", paid: true, selfHosted: false, confidence: 0.95, freshness: "live", costPerCall: 0.01, enabled: () => hasEnv("OPENAI_API_KEY") },
  { id: "anthropic-generate", capability: "generate", category: "internal_reasoning", paid: true, selfHosted: false, confidence: 0.95, freshness: "live", costPerCall: 0.01, enabled: () => hasEnv("ANTHROPIC_API_KEY") },

  { id: "smtp-email", capability: "email", category: "execution", paid: false, selfHosted: true, confidence: 0.8, freshness: "live", costPerCall: 0, enabled: () => hasEnv("SMTP_HOST") },
  { id: "resend-email", capability: "email", category: "execution", paid: true, selfHosted: false, confidence: 0.9, freshness: "live", costPerCall: 0.0004, enabled: () => hasEnv("RESEND_API_KEY") },

  { id: "direct-social", capability: "social", category: "execution", paid: false, selfHosted: true, confidence: 0.75, freshness: "live", costPerCall: 0, enabled: () => hasEnv("X_ACCESS_TOKEN") || (hasEnv("LINKEDIN_ACCESS_TOKEN") && hasEnv("LINKEDIN_AUTHOR_URN")) },

  { id: "ip-asn-enrich", capability: "enrich", category: "surface_measurement", paid: false, selfHosted: true, confidence: 0.5, freshness: "recent", costPerCall: 0, enabled: () => true },
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
 * Ranked, currently-usable adapters for a capability (customer-facing). Order:
 * non-fallback before `fallback_only`, then self-hosted/free first, then higher
 * confidence, then healthier (fewer recent failures), then cheaper. Two hard
 * exclusions enforce the cost firewall:
 *   - `benchmark_only` adapters (incl. BENCHMARK_ONLY_PROVIDERS overrides) are
 *     NEVER returned — they exist only for audit/comparison scripts.
 *   - paid adapters are dropped entirely in Zero-Paid-Keys mode.
 * Because `internal_reasoning` adapters that are self-hosted (Ollama) sort ahead
 * of paid ones, internal reasoning is local-first by construction.
 */
export function rankedAdapters(capability: Capability): Adapter[] {
  const zeroPaid = isZeroPaidKeysMode();
  return registry[capability]
    .filter((a) => a.enabled() && effectiveCategory(a) !== "benchmark_only" && !(zeroPaid && a.paid))
    .sort((a, b) => {
      const fbA = a.category === "fallback_only" ? 1 : 0;
      const fbB = b.category === "fallback_only" ? 1 : 0;
      if (fbA !== fbB) return fbA - fbB;
      if (a.paid !== b.paid) return a.paid ? 1 : -1;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      const fa = getHealth(a.id).failures;
      const fb = getHealth(b.id).failures;
      if (fa !== fb) return fa - fb;
      return a.costPerCall - b.costPerCall;
    });
}

/**
 * Adapters that are benchmark-only right now (either declared or forced via
 * BENCHMARK_ONLY_PROVIDERS). Audit/benchmark scripts may call these directly;
 * route() never will.
 */
export function benchmarkOnlyAdapters(): Adapter[] {
  const all: Adapter[] = (Object.keys(registry) as Capability[]).flatMap((c) => registry[c]);
  return all.filter((a) => effectiveCategory(a) === "benchmark_only");
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
    const breakerKey = `route:${adapter.id}`;
    if (adapter.id === "serper" || adapter.id === "brave") {
      const allowed = await isProviderCallAllowed(adapter.id as "serper" | "brave");
      if (!allowed) {
        trail.push({ id: adapter.id, ok: false, error: "monthly cap reached" });
        continue;
      }
    }
    try {
      // The breaker fast-fails a provider that has failed repeatedly so we don't
      // pay its full timeout on every call while it's down — failover stays snappy.
      const result = await withBreaker(breakerKey, async () => {
        const r = (await adapter.run!(...(args as unknown[]))) as ProviderResult<TData>;
        // Treat an unsuccessful provider envelope as a breaker failure too (many
        // adapters return {success:false} instead of throwing).
        if (!r.success || r.data === undefined) {
          throw new Error(r.error || `${adapter.id} returned no data`);
        }
        return r;
      });
      const h = getHealth(adapter.id);
      h.failures = 0;
      h.lastOkAt = Date.now();
      trail.push({ id: adapter.id, ok: true });
      return { ...result, provider: adapter.id, trail };
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        trail.push({ id: adapter.id, ok: false, error: "circuit open" });
        continue;
      }
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
  category: ProviderCategory;
  paid: boolean;
  selfHosted: boolean;
  enabled: boolean;
  usableNow: boolean;
  confidence: number;
  freshness: Freshness;
  costPerCall: number;
  failures: number;
  /** Circuit-breaker state for this adapter's route() calls (operator signal). */
  circuit: CircuitStatus;
}

/** Diagnostic catalog of every adapter and whether it's usable right now. */
export function describeProviders(): AdapterStatus[] {
  const zeroPaid = isZeroPaidKeysMode();
  const all: Adapter[] = (Object.keys(registry) as Capability[]).flatMap((c) => registry[c]);
  return all.map((a) => {
    const category = effectiveCategory(a);
    return {
      id: a.id,
      capability: a.capability,
      category,
      paid: a.paid,
      selfHosted: a.selfHosted,
      enabled: a.enabled(),
      // Usable for a customer-facing route right now: enabled, not benchmark-only,
      // and not a paid vendor while in Zero-Paid-Keys mode.
      usableNow: a.enabled() && category !== "benchmark_only" && !(zeroPaid && a.paid),
      confidence: a.confidence,
      freshness: a.freshness,
      costPerCall: a.costPerCall,
      failures: getHealth(a.id).failures,
      circuit: circuitStatus(`route:${a.id}`),
    };
  });
}

export interface CapabilityComparison {
  capability: Capability;
  /** Best sovereign (non-paid) adapter by confidence, if any. */
  sovereign: { id: string; confidence: number; costPerCall: number; freshness: Freshness } | null;
  /** Best paid adapter by confidence, if any. */
  paid: { id: string; confidence: number; costPerCall: number; freshness: Freshness } | null;
  /** Per-call USD saved by using the sovereign adapter instead of the paid one. */
  costSavingPerCall: number;
  /** Confidence gap (paid - sovereign); negative means sovereign is also higher confidence. */
  confidenceGap: number;
  /** True when a sovereign adapter exists and costs no more than the paid one. */
  sovereignWins: boolean;
}

function bestByConfidence(adapters: Adapter[]): Adapter | null {
  if (adapters.length === 0) return null;
  return [...adapters].sort((a, b) => b.confidence - a.confidence)[0];
}

/**
 * Sovereign-vs-paid comparison per capability. The honest "outperform" proof:
 * we win on the axes we control (cost, coverage, freshness, integration) — this
 * exposes those deltas rather than claiming we beat paid indexes on raw breadth.
 */
export function compareCapabilities(): CapabilityComparison[] {
  const caps = Object.keys(registry) as Capability[];
  return caps.map((capability) => {
    const sov = bestByConfidence(registry[capability].filter((a) => !a.paid));
    const paid = bestByConfidence(registry[capability].filter((a) => a.paid));
    const sovereign = sov
      ? { id: sov.id, confidence: sov.confidence, costPerCall: sov.costPerCall, freshness: sov.freshness }
      : null;
    const paidInfo = paid
      ? { id: paid.id, confidence: paid.confidence, costPerCall: paid.costPerCall, freshness: paid.freshness }
      : null;
    const costSavingPerCall = sov && paid ? Math.max(0, paid.costPerCall - sov.costPerCall) : sov ? 0 : 0;
    const confidenceGap = sov && paid ? paid.confidence - sov.confidence : 0;
    return {
      capability,
      sovereign,
      paid: paidInfo,
      costSavingPerCall,
      confidenceGap,
      sovereignWins: Boolean(sov && (!paid || sov.costPerCall <= paid.costPerCall)),
    };
  });
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
