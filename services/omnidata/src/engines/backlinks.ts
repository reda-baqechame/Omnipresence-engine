import type { BacklinkRow } from "../types.js";
import { runSerpLive } from "./serp.js";

const OPR_KEY = process.env.OPENPAGERANK_API_KEY;

async function fetchOpenPageRank(domain: string): Promise<number | undefined> {
  if (!OPR_KEY) return undefined;
  try {
    const res = await fetch(
      `https://openpagerank.com/api/v1.0/getPageRank?domains[]=${encodeURIComponent(domain)}`,
      { headers: { "API-OPR": OPR_KEY } }
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      response?: Array<{ domain: string; page_rank_integer?: number }>;
    };
    return data.response?.[0]?.page_rank_integer;
  } catch {
    return undefined;
  }
}

async function fetchCommonCrawlBacklinks(domain: string): Promise<BacklinkRow[]> {
  try {
    const indexRes = await fetch("https://index.commoncrawl.org/collinfo.json");
    if (!indexRes.ok) return [];
    const indexes = (await indexRes.json()) as Array<{ id: string }>;
    const latest = indexes[0]?.id;
    if (!latest) return [];

    const query = `https://index.commoncrawl.org/${latest}-index?url=*.${encodeURIComponent(domain)}/*&output=json&limit=20`;
    const res = await fetch(query);
    if (!res.ok) return [];

    const text = await res.text();
    const rows: BacklinkRow[] = [];
    for (const line of text.split("\n").filter(Boolean)) {
      try {
        const row = JSON.parse(line) as { url: string; timestamp: string };
        const sourceUrl = row.url;
        let sourceDomain = "";
        try {
          sourceDomain = new URL(sourceUrl).hostname;
        } catch {
          continue;
        }
        rows.push({
          source_url: sourceUrl,
          source_domain: sourceDomain,
          target_url: `https://${domain}`,
          anchor: "",
          first_seen: row.timestamp,
          last_seen: row.timestamp,
        });
      } catch {
        // skip malformed line
      }
    }
    return rows;
  } catch {
    return [];
  }
}

async function fetchLinkOperatorBacklinks(domain: string): Promise<BacklinkRow[]> {
  const serp = await runSerpLive(`link:${domain}`);
  const items = serp.tasks[0]?.result[0]?.items || [];
  return items
    .filter((i) => i.type === "organic" && i.url)
    .map((i) => {
      let sourceDomain = "";
      try {
        sourceDomain = new URL(i.url!).hostname;
      } catch {
        sourceDomain = "";
      }
      return {
        source_url: i.url!,
        source_domain: sourceDomain,
        target_url: `https://${domain}`,
        anchor: i.title || "",
        last_seen: new Date().toISOString(),
      };
    });
}

export async function runBacklinks(target: string): Promise<{
  target: string;
  total_count: number;
  referring_domains: number;
  domain_rank?: number;
  items: BacklinkRow[];
}> {
  const domain = target.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

  const [cc, linkOp, dr] = await Promise.all([
    fetchCommonCrawlBacklinks(domain),
    fetchLinkOperatorBacklinks(domain),
    fetchOpenPageRank(domain),
  ]);

  const seen = new Set<string>();
  const merged: BacklinkRow[] = [];
  for (const row of [...cc, ...linkOp]) {
    const key = `${row.source_domain}::${row.target_url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...row, domain_rank: dr });
  }

  const referringDomains = new Set(merged.map((r) => r.source_domain).filter(Boolean));

  return {
    target: domain,
    total_count: merged.length,
    referring_domains: referringDomains.size,
    domain_rank: dr,
    items: merged.slice(0, 100),
  };
}
