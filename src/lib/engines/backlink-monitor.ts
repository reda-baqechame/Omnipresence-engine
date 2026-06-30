import type { SupabaseClient } from "@supabase/supabase-js";
import { getBacklinks, getBacklinkGraph, getLinkIntersection } from "@/lib/providers/dataforseo";
import { getBacklinksFree } from "@/lib/providers/backlinks-free";
import { hasSerpCapability } from "@/lib/config/capabilities";
import { recordMeasurementEvidence } from "@/lib/engines/evidence";

const BACKLINK_GRAPH_PARSER_VERSION = "backlink-graph@1";

export interface BacklinkRow {
  url: string;
  domain: string;
  rank: number;
}

export interface BacklinkDiff {
  newLinks: BacklinkRow[];
  lostLinks: BacklinkRow[];
  totalCurrent: number;
  totalPrevious: number;
}

async function fetchCurrentBacklinks(domain: string): Promise<BacklinkRow[]> {
  const omnidata = await getBacklinks(domain);
  if (omnidata.success && omnidata.data?.length) {
    return omnidata.data.map((b) => ({
      url: b.url,
      domain: b.domain,
      rank: b.rank,
    }));
  }

  if (hasSerpCapability()) {
    const free = await getBacklinksFree(domain, 30);
    if (free.success && free.data) return free.data;
  }

  return [];
}

export async function snapshotProjectBacklinks(
  supabase: SupabaseClient,
  projectId: string,
  domain: string
): Promise<{ count: number; diff?: BacklinkDiff }> {
  const backlinks = await fetchCurrentBacklinks(domain);
  const key = (b: BacklinkRow) => b.domain.toLowerCase();

  const { data: previous } = await supabase
    .from("backlink_snapshots")
    .select("backlinks, total_count")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevRows = (previous?.backlinks as BacklinkRow[] | null) || [];
  const prevMap = new Map(prevRows.map((b) => [key(b), b]));
  const currMap = new Map(backlinks.map((b) => [key(b), b]));

  const newLinks = backlinks.filter((b) => !prevMap.has(key(b)));
  const lostLinks = prevRows.filter((b) => !currMap.has(key(b)));

  await supabase.from("backlink_snapshots").insert({
    project_id: projectId,
    backlinks,
    total_count: backlinks.length,
    new_count: newLinks.length,
    lost_count: lostLinks.length,
  });

  const diff: BacklinkDiff | undefined = previous
    ? {
        newLinks,
        lostLinks,
        totalCurrent: backlinks.length,
        totalPrevious: previous.total_count ?? prevRows.length,
      }
    : undefined;

  return { count: backlinks.length, diff };
}

export interface BacklinkGraphSnapshotResult {
  available: boolean;
  reason?: string;
  totalLinks: number;
  newCount: number;
  lostCount: number;
  toxicCount: number;
}

/**
 * Refresh the URL-level Presence Backlink Graph for a project: triggers a
 * crawl-verified re-scan (which updates the OmniData temporal store and thus
 * new/lost), computes competitor link intersection, and persists a rollup
 * snapshot. Best-effort and keyless-first; degrades to unavailable when OmniData
 * isn't configured/ingested. Called weekly by weeklyBacklinkMonitor.
 */
export async function snapshotProjectBacklinkGraph(
  supabase: SupabaseClient,
  projectId: string,
  domain: string,
  competitors: string[] = []
): Promise<BacklinkGraphSnapshotResult> {
  const graph = await getBacklinkGraph(domain, 40);
  if (!graph || graph.dataSource === "unavailable") {
    return {
      available: false,
      reason: "URL-level graph unavailable (OmniData/webgraph not ingested).",
      totalLinks: 0,
      newCount: 0,
      lostCount: 0,
      toxicCount: 0,
    };
  }

  const intersection = competitors.length
    ? await getLinkIntersection(domain, competitors, 2)
    : null;

  const topLinks = graph.links
    .filter((l) => l.verification !== "lost")
    .slice(0, 100)
    .map((l) => ({
      source_url: l.sourceUrl,
      source_domain: l.sourceDomain,
      anchor: l.anchor,
      nofollow: l.nofollow,
      domain_rank: l.domainRank ?? null,
      spam_risk: l.spamRisk,
      link_value: l.linkValue,
      first_seen: l.firstSeen,
      last_seen: l.lastSeen,
    }));

  const intersectionRows = (intersection?.rows ?? []).slice(0, 100).map((r) => ({
    source_domain: r.sourceDomain,
    links_to: r.linksTo,
    count: r.count,
    authority: r.authority,
    brand_gap: r.brandGap,
  }));

  await supabase.from("backlink_graph_snapshots").insert({
    project_id: projectId,
    total_links: graph.totalLinks,
    referring_domains: graph.referringDomains,
    new_count: graph.newCount,
    lost_count: graph.lostCount,
    toxic_count: graph.toxicCount,
    nofollow_count: graph.nofollowCount,
    data_source: graph.dataSource,
    top_links: topLinks,
    intersection: intersectionRows,
  });

  // First-class evidence for the backlink graph measurement (best-effort).
  await recordMeasurementEvidence(supabase, {
    projectId,
    capability: "backlink_graph",
    target: domain,
    provider: "omnidata",
    sourceUrl: `https://${domain}`,
    parserVersion: BACKLINK_GRAPH_PARSER_VERSION,
    dataSource: graph.dataSource,
    rawPayload: { totalLinks: graph.totalLinks, links: graph.links?.slice(0, 500), intersection: intersectionRows },
    excerpt: {
      total_links: graph.totalLinks,
      referring_domains: graph.referringDomains,
      new_count: graph.newCount,
      lost_count: graph.lostCount,
      toxic_count: graph.toxicCount,
    },
  }).catch(() => {});

  return {
    available: true,
    totalLinks: graph.totalLinks,
    newCount: graph.newCount,
    lostCount: graph.lostCount,
    toxicCount: graph.toxicCount,
  };
}

export async function getLatestBacklinkDiff(
  supabase: SupabaseClient,
  projectId: string
): Promise<BacklinkDiff | null> {
  const { data: snapshots } = await supabase
    .from("backlink_snapshots")
    .select("backlinks, total_count, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(2);

  if (!snapshots || snapshots.length < 2) return null;

  const current = (snapshots[0].backlinks as BacklinkRow[]) || [];
  const previous = (snapshots[1].backlinks as BacklinkRow[]) || [];
  const key = (b: BacklinkRow) => b.domain.toLowerCase();
  const prevMap = new Map(previous.map((b) => [key(b), b]));
  const currMap = new Map(current.map((b) => [key(b), b]));

  return {
    newLinks: current.filter((b) => !prevMap.has(key(b))),
    lostLinks: previous.filter((b) => !currMap.has(key(b))),
    totalCurrent: current.length,
    totalPrevious: previous.length,
  };
}
