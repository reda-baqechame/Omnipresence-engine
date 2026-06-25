import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import { getBacklinks, isOmniDataActive, hasLabsApi } from "@/lib/providers/dataforseo";
import type { ProviderResult } from "./types";

export interface BacklinkItem {
  url: string;
  domain: string;
  rank: number;
  /** True when the row came from the deprecated `link:` operator (approximate). */
  estimated?: boolean;
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Inbound links for a domain. Prefers the real backlink index (OmniData Common
 * Crawl webgraph or DataForSEO); falls back to the deprecated `link:` SERP
 * operator only when no index is available, flagging those rows `estimated`.
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

  // 2) Fallback: deprecated `link:` operator — flagged estimated.
  const res = await searchGoogleOrganicRouter(
    `link:${cleanDomain}`,
    "United States",
    cleanDomain,
    []
  );

  if (!res.success || !res.data) {
    return { success: false, error: res.error || "Backlink discovery failed" };
  }

  const seen = new Set<string>();
  const items: BacklinkItem[] = [];

  for (const result of res.data.organicResults) {
    const linkDomain = hostnameFromUrl(result.url);
    if (!linkDomain || linkDomain.includes(cleanDomain)) continue;
    if (seen.has(linkDomain)) continue;
    seen.add(linkDomain);

    items.push({
      url: result.url,
      domain: linkDomain,
      rank: Math.max(100 - result.position * 4, 15),
      estimated: true,
    });

    if (items.length >= limit) break;
  }

  return { success: true, data: items, creditsUsed: res.creditsUsed };
}
