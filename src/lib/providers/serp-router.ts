/**
 * SERP routing facade. The ranking, failover and health logic now lives in the
 * unified provider router (Wave H); this module preserves the long-standing
 * `searchGoogleOrganicRouter` / `getActiveSerpProvider` API its many callers
 * depend on, delegating to `routeSerp`.
 */
import { isOmniDataActive } from "@/lib/providers/dataforseo";
import { hasSearxngCapability } from "@/lib/providers/searxng";
import { hasFirecrawlCapability } from "@/lib/providers/firecrawl";
import { routeSerp, routeGoogleSerp, rankedAdapters } from "@/lib/providers/router";
import type { ProviderResult, SERPResult } from "./types";

export type SerpProviderId = "serper" | "brave" | "searxng" | "duckduckgo" | "firecrawl" | "omnidata" | "dataforseo";

function hasEnv(key: string): boolean {
  const v = process.env[key];
  return Boolean(v && v.length > 0 && !v.startsWith("your-"));
}

export function getActiveSerpProvider(): SerpProviderId | null {
  // Honour the router's ranking (self-hosted/free first, paid optional, and
  // Zero-Paid-Keys aware) so the "active" provider matches what actually runs.
  const top = rankedAdapters("serp")[0];
  if (top) return top.id as SerpProviderId;

  // Defensive fallback mirroring the previous static priority.
  if (hasEnv("SERPER_API_KEY")) return "serper";
  if (hasEnv("BRAVE_SEARCH_API_KEY")) return "brave";
  if (hasSearxngCapability()) return "searxng";
  if (isOmniDataActive()) return "omnidata";
  if (hasEnv("DATAFORSEO_LOGIN") && hasEnv("DATAFORSEO_PASSWORD")) return "dataforseo";
  if (hasFirecrawlCapability()) return "firecrawl";
  return null;
}

export async function searchGoogleOrganicRouter(
  keyword: string,
  location = "United States",
  brandDomain: string,
  competitors: string[]
): Promise<ProviderResult<SERPResult> & { provider?: SerpProviderId }> {
  const outcome = await routeSerp(keyword, location, brandDomain, competitors);
  return {
    success: outcome.success,
    data: outcome.data,
    error: outcome.error,
    creditsUsed: outcome.creditsUsed,
    provider: outcome.provider as SerpProviderId | undefined,
  };
}

/**
 * Google-authentic SERP (surface-identity gate): only providers that genuinely
 * query Google (Serper, OmniData, DataForSEO, Firecrawl) are eligible. Use this
 * for `google_organic` / `google_ai_overview` visibility claims; use
 * `searchGoogleOrganicRouter` for generic "web SERP" needs where any engine is
 * acceptable (keyword research, coverage checks, etc.).
 */
export async function searchGoogleSerpAuthentic(
  keyword: string,
  location = "United States",
  brandDomain: string,
  competitors: string[]
): Promise<ProviderResult<SERPResult> & { provider?: SerpProviderId }> {
  const outcome = await routeGoogleSerp(keyword, location, brandDomain, competitors);
  return {
    success: outcome.success,
    data: outcome.data,
    error: outcome.error,
    creditsUsed: outcome.creditsUsed,
    provider: outcome.provider as SerpProviderId | undefined,
  };
}
