import type { SupabaseClient } from "@supabase/supabase-js";
import { getBacklinks } from "@/lib/providers/dataforseo";
import { getBacklinksFree } from "@/lib/providers/backlinks-free";
import { hasSerpCapability } from "@/lib/config/capabilities";

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
