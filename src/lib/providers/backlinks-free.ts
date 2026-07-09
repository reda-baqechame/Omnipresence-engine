import { getBacklinks, isOmniDataActive } from "@/lib/providers/dataforseo";
import { resolveDomainAuthority } from "@/lib/providers/domain-authority";
import { buildProviderEnvelope } from "@/lib/providers/envelope";
import type { ProviderResult } from "./types";

export interface BacklinkItem {
  url: string;
  domain: string;
  rank: number;
  /** True when the row came from an approximate source rather than a real index. */
  estimated?: boolean;
  /** Real 0-100 authority (Common Crawl/Tranco/rank.to) — free DR that paid indexes bill for. */
  authority?: number;
  authoritySource?: "commoncrawl" | "ccwebgraph" | "openpagerank" | "tranco" | "rank.to" | "unlisted";
}

/**
 * Attach a real, keyless 0-100 authority score (Tranco -> rank.to) to each
 * referring domain. This is the concrete integration win over DataForSEO/Ahrefs:
 * they charge separately for domain authority; we fold it in for free. Capped
 * concurrency keeps the public Tranco API friendly.
 */
export async function enrichWithAuthority(items: BacklinkItem[]): Promise<BacklinkItem[]> {
  const top = items.slice(0, 25);
  await Promise.all(
    top.map(async (item) => {
      try {
        const a = await resolveDomainAuthority(item.domain);
        item.authority = a.score;
        item.authoritySource = a.source;
      } catch {
        // Authority is additive; never fail the backlink row over it.
      }
    })
  );
  return items;
}

/**
 * Sovereign inbound-link fetch for the `commoncrawl-webgraph` router adapter.
 *
 * OmniData Common Crawl webgraph ONLY — never calls paid DataForSEO Labs.
 * Paid fallback is the separate `dataforseo-backlinks` adapter in
 * `capability-runners.ts` (via `fetchBacklinks()` → `rankedAdapters()`).
 * When OmniData is inactive this returns `success:false` (unavailable),
 * never a fabricated zero.
 */
export async function getBacklinksFree(
  domain: string,
  limit = 20
): Promise<ProviderResult<BacklinkItem[]>> {
  const cleanDomain = domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();

  if (!cleanDomain) {
    return { success: false, error: "Invalid domain" };
  }

  // Sovereign path only — Patch J: paid DataForSEO must not run inside this adapter.
  if (isOmniDataActive()) {
    const real = await getBacklinks(cleanDomain, limit);
    if (real.success && real.data && real.data.length > 0) {
      const seen = new Set<string>();
      const items: BacklinkItem[] = [];
      for (const b of real.data) {
        const linkDomain = (b.domain || "").replace(/^www\./, "").toLowerCase();
        if (!linkDomain || linkDomain.includes(cleanDomain) || seen.has(linkDomain)) continue;
        seen.add(linkDomain);
        items.push({ url: b.url, domain: linkDomain, rank: b.rank, estimated: false });
        if (items.length >= limit) break;
      }
      if (items.length > 0) {
        await enrichWithAuthority(items);
        return {
          success: true,
          data: items,
          creditsUsed: real.creditsUsed,
          envelope: buildProviderEnvelope({
            capability: "backlinks",
            provider: "omnidata-webgraph",
            providerClass: "surface_measurement",
            dataSource: "measured",
            freshness: "recent",
            confidence: 0.9,
            parserVersion: "backlinks-free@1",
            payload: items,
          }),
        };
      }
    }
  }

  // No sovereign backlink index available.
  //
  // We deliberately DO NOT fall back to Google's deprecated `link:` operator or
  // call paid DataForSEO from this adapter (that would bypass Patch J ranking).
  // Callers that need failover should use `fetchBacklinks()` from
  // capability-runners, which tries commoncrawl-webgraph then dataforseo-backlinks.
  return {
    success: false,
    error:
      "No sovereign backlink index configured. Enable OmniData (keyless Common Crawl webgraph). Paid DataForSEO is available only via fetchBacklinks() router failover.",
  };
}
