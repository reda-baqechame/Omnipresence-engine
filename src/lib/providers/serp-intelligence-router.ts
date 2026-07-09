/**
 * Shot 2 — routed SERP intelligence (ads/PAA/local/AI overview).
 *
 * Full SERP-feature decomposition requires the OmniData/DataForSEO advanced
 * endpoint. Free SERP adapters (Serper/Brave/SearXNG) cannot supply paid-block
 * intelligence — we refuse to call getSerpIntelligence() when only those are
 * active, instead of bypassing router ranking with a direct paid call.
 *
 * Budget guard is enforced inside dataForSEORequest() (transitive).
 */
import {
  getSerpIntelligence,
  isOmniDataActive,
  type SerpIntelligenceResult,
} from "@/lib/providers/dataforseo";
import { getActiveSerpProvider } from "@/lib/providers/serp-router";

export type SerpIntelligenceProviderId = "omnidata" | "dataforseo";

/** Returns true when advanced SERP intelligence can be fetched honestly. */
export function isSerpIntelligenceAvailable(): boolean {
  if (isOmniDataActive()) return true;
  const active = getActiveSerpProvider();
  return active === "omnidata" || active === "dataforseo";
}

export function serpIntelligenceUnavailableReason(): string {
  return "SERP ads/features need the sovereign OmniData SERP backend (set OMNIDATA_BASE_URL) or DataForSEO fallback.";
}

/**
 * Fetch live SERP intelligence through the active advanced backend only.
 * Returns null when unavailable — never fabricates ads or features.
 */
export async function routeSerpIntelligence(
  keyword: string,
  location = "United States",
  device: "desktop" | "mobile" = "desktop"
): Promise<SerpIntelligenceResult | null> {
  if (!isSerpIntelligenceAvailable()) return null;
  return getSerpIntelligence(keyword, location, device);
}
