import { getBacklinks, isOmniDataActive, hasLabsApi } from "@/lib/providers/dataforseo";
import type { ProviderResult } from "./types";

export interface BacklinkItem {
  url: string;
  domain: string;
  rank: number;
  /** True when the row came from an approximate source rather than a real index. */
  estimated?: boolean;
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
