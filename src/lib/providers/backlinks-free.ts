import { getBacklinks, isOmniDataActive, hasLabsApi } from "@/lib/providers/dataforseo";
import { resolveDomainAuthority } from "@/lib/providers/domain-authority";
import type { ProviderResult } from "./types";

export interface BacklinkItem {
  url: string;
  domain: string;
  rank: number;
  /** True when the row came from an approximate source rather than a real index. */
  estimated?: boolean;
  /** Real 0-100 authority (Common Crawl/Tranco/rank.to) — free DR that paid indexes bill for. */
  authority?: number;
  authoritySource?: "commoncrawl" | "tranco" | "rank.to" | "unlisted";
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
 * Inbound links for a domain from a REAL backlink index (OmniData Common Crawl
 * webgraph or DataForSEO). When no index is configured it returns
 * `success:false` (unavailable) rather than fabricating data — callers should
 * surface "backlinks unavailable", never a misleading 0.
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

  // 1) Real index first (webgraph via OmniData, or DataForSEO backlinks).
  if (isOmniDataActive() || hasLabsApi()) {
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
        return { success: true, data: items, creditsUsed: real.creditsUsed };
      }
    }
  }

  // 2) No real backlink index available.
  //
  // We deliberately DO NOT fall back to Google's deprecated `link:` operator: it
  // returns almost nothing and forces a fabricated "rank" from SERP position,
  // i.e. invented authority presented as data. An expert (and refund-safety)
  // demands we say "unavailable" instead of emitting noise. Connect OmniData
  // (keyless Common Crawl webgraph) or DataForSEO for real referring domains.
  return {
    success: false,
    error:
      "No backlink index configured. Enable OmniData (keyless Common Crawl webgraph) or DataForSEO for real referring-domain data.",
  };
}
