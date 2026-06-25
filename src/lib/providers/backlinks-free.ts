import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import type { ProviderResult } from "./types";

export interface BacklinkItem {
  url: string;
  domain: string;
  rank: number;
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Discover inbound links via `link:domain` SERP queries (free/cheap — no backlink index API). */
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
    });

    if (items.length >= limit) break;
  }

  return { success: true, data: items, creditsUsed: res.creditsUsed };
}
