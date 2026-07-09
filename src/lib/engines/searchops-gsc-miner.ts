/**
 * SearchOps GSC v2 miner — pure functions over already-loaded rank/GSC rows.
 * Never calls Google APIs, OmniData, or paid providers.
 */
import type { SearchOpsOpportunity } from "@/lib/engines/searchops-opportunity-engine";

export type CannibalizationUrl = { url: string; position: number };

export type RankKeywordCannibalRow = {
  keyword?: string | null;
  last_position?: number | null;
  cannibalization_urls?: CannibalizationUrl[] | null;
  target_url?: string | null;
};

function parseCannibalUrls(raw: unknown): CannibalizationUrl[] {
  if (!Array.isArray(raw)) return [];
  const out: CannibalizationUrl[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const url = String((item as { url?: unknown }).url || "").trim();
    const position = Number((item as { position?: unknown }).position);
    if (!url || !Number.isFinite(position)) continue;
    out.push({ url, position });
  }
  return out;
}

/**
 * Mine query cannibalization opportunities from measured rank_keywords rows.
 * Requires 2+ brand URLs ranking for the same keyword (SERP evidence).
 */
export function mineCannibalizationOpportunities(
  projectId: string,
  rows: RankKeywordCannibalRow[],
  opts: { max?: number } = {}
): SearchOpsOpportunity[] {
  const max = opts.max ?? 12;
  const out: SearchOpsOpportunity[] = [];

  for (const row of rows) {
    const keyword = String(row.keyword || "").trim();
    if (!keyword) continue;
    const urls = parseCannibalUrls(row.cannibalization_urls);
    if (urls.length < 2) continue;

    const sorted = [...urls].sort((a, b) => a.position - b.position);
    const primary = sorted[0];
    const urlCount = sorted.length;
    // Confidence rises with more competing URLs; capped.
    const confidence = Math.min(0.95, 0.55 + urlCount * 0.1);
    const positions = sorted.map((u) => `#${u.position}`).join(", ");

    out.push({
      id: `${projectId}:cannibalization:${keyword.toLowerCase()}`,
      projectId,
      category: "serp",
      title: `Query cannibalization: “${keyword}” split across ${urlCount} URLs`,
      diagnosis: `Measured SERP check shows ${urlCount} brand URLs ranking for “${keyword}” (positions ${positions}), weakening consolidation.`,
      evidence: [
        {
          label: "Brand URLs in SERP for query",
          source: "rank_snapshots",
          status: "measured",
          confidence,
          value: {
            keyword,
            urlCount,
            urls: sorted,
            last_position: row.last_position ?? null,
          },
        },
      ],
      priority: urlCount >= 3 ? "high" : "medium",
      impactType: "measured",
      effort: "medium",
      recommendedAction: `Consolidate “${keyword}” toward the strongest URL (${primary.url} at position ${primary.position}): merge/redirect weaker URLs or canonicalize, and point internal links to the primary.`,
      verificationPlan:
        "Re-run rank check for this keyword; cannibalization_urls should drop to 0 or 1 brand URL in the SERP snapshot.",
      limitations: [
        "SERP cannibalization is a snapshot; results can vary by location/device.",
        "Consolidation does not guarantee a higher primary position.",
      ],
    });
  }

  return out
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, max);
}

/**
 * Cluster striking-distance queries that share the same target_url.
 * Returns a map of normalized target URL → related query strings (2+ only).
 */
export function clusterStrikingDistanceByTargetUrl(
  rankRows: Array<{ keyword?: string | null; target_url?: string | null; last_position?: number | null; is_striking_distance?: boolean | null }>,
  strikingQueries: string[]
): Map<string, string[]> {
  const strikeSet = new Set(strikingQueries.map((q) => q.toLowerCase()));
  const byUrl = new Map<string, string[]>();

  for (const row of rankRows) {
    const keyword = String(row.keyword || "").trim();
    const target = String(row.target_url || "").trim();
    if (!keyword || !target) continue;
    const pos = Number(row.last_position);
    const isStrike =
      row.is_striking_distance === true ||
      (Number.isFinite(pos) && pos > 3 && pos <= 20) ||
      strikeSet.has(keyword.toLowerCase());
    if (!isStrike) continue;

    const key = target.toLowerCase();
    const list = byUrl.get(key) || [];
    if (!list.some((q) => q.toLowerCase() === keyword.toLowerCase())) {
      list.push(keyword);
    }
    byUrl.set(key, list);
  }

  // Keep only clusters with 2+ queries.
  for (const [url, queries] of [...byUrl.entries()]) {
    if (queries.length < 2) byUrl.delete(url);
    else byUrl.set(url, queries.sort((a, b) => a.localeCompare(b)));
  }
  return byUrl;
}

type EnrichableGscOpp = {
  kind: string;
  queryOrUrl: string;
  relatedQueries?: string[];
};

/**
 * Attach relatedQueries to striking-distance GSC opp rows when a page cluster exists.
 * Does not invent new opportunity kinds — enrichment only.
 */
export function enrichStrikingDistanceWithClusters<T extends EnrichableGscOpp>(
  gscOpps: T[],
  clusters: Map<string, string[]>,
  rankRows: Array<{ keyword?: string | null; target_url?: string | null }>
): T[] {
  const keywordToTarget = new Map<string, string>();
  for (const row of rankRows) {
    const keyword = String(row.keyword || "").trim().toLowerCase();
    const target = String(row.target_url || "").trim().toLowerCase();
    if (keyword && target) keywordToTarget.set(keyword, target);
  }

  return gscOpps.map((opp) => {
    if (opp.kind !== "striking_distance") return opp;
    const target = keywordToTarget.get(opp.queryOrUrl.toLowerCase());
    if (!target) return opp;
    const related = clusters.get(target);
    if (!related || related.length < 2) return opp;
    return { ...opp, relatedQueries: related };
  });
}
