/**
 * Shot 2 — internal backlink intelligence wrapper.
 *
 * Referring-domain lists route through capability-runners (sovereign-first).
 * URL-level graph + intersection require OmniData ingest and remain behind
 * isOmniDataActive() — DataForSEO is not promoted as primary.
 */
import {
  getBacklinkGraph,
  getLinkIntersection,
  isOmniDataActive,
  type BacklinkGraph,
  type LinkIntersection,
} from "@/lib/providers/dataforseo";
import { fetchBacklinks } from "@/lib/providers/capability-runners";
import type { BacklinkItem } from "@/lib/providers/backlinks-free";

export interface RoutedReferringDomains {
  available: boolean;
  reason?: string;
  provider?: string;
  data: Array<{ url: string; domain: string; rank: number }>;
}

/** Sovereign-first referring domains through the backlinks router port. */
export async function routeReferringDomains(
  domain: string,
  limit = 50
): Promise<RoutedReferringDomains> {
  const outcome = await fetchBacklinks(domain, limit);
  if (outcome.success && outcome.data && outcome.data.length > 0) {
    return {
      available: true,
      provider: outcome.provider,
      data: outcome.data.map((b) => ({
        url: b.url,
        domain: b.domain,
        rank: b.rank ?? 0,
      })),
    };
  }
  return {
    available: false,
    reason: outcome.error || "Backlink index unavailable for this domain.",
    provider: outcome.provider,
    data: [],
  };
}

export interface RoutedBacklinkGraph {
  available: boolean;
  reason?: string;
  graph: BacklinkGraph | null;
}

/** URL-level graph — OmniData only; unavailable when not ingested. */
export async function routeBacklinkGraph(
  domain: string,
  maxSources = 40
): Promise<RoutedBacklinkGraph> {
  if (!isOmniDataActive()) {
    return {
      available: false,
      reason: "URL-level graph unavailable (OmniData not configured).",
      graph: null,
    };
  }
  const graph = await getBacklinkGraph(domain, maxSources);
  if (!graph || graph.dataSource === "unavailable") {
    return {
      available: false,
      reason: "URL-level graph unavailable (OmniData/webgraph not ingested).",
      graph: null,
    };
  }
  return { available: true, graph };
}

export async function routeLinkIntersection(
  domain: string,
  competitors: string[],
  minOverlap = 2
): Promise<LinkIntersection | null> {
  if (!isOmniDataActive() || competitors.length === 0) return null;
  return getLinkIntersection(domain, competitors, minOverlap);
}

export type { BacklinkItem, BacklinkGraph, LinkIntersection };
