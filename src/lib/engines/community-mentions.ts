export interface CommunityMentionRow {
  platform: "reddit" | "quora" | "other";
  url: string;
  keyword?: string;
  mention_type?: "brand" | "competitor" | "category";
  competitor?: string;
}

export function parseMentionsCsv(csv: string): CommunityMentionRow[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const urlIdx = header.findIndex((h) => h.includes("url"));
  const platformIdx = header.findIndex((h) => h.includes("platform"));
  const kwIdx = header.findIndex((h) => h.includes("keyword"));

  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const url = cols[urlIdx >= 0 ? urlIdx : 0] || "";
    let platform: CommunityMentionRow["platform"] = "other";
    const p = (cols[platformIdx >= 0 ? platformIdx : 1] || "").toLowerCase();
    if (p.includes("reddit")) platform = "reddit";
    else if (p.includes("quora")) platform = "quora";
    else if (url.includes("reddit.com")) platform = "reddit";
    else if (url.includes("quora.com")) platform = "quora";

    return {
      platform,
      url,
      keyword: kwIdx >= 0 ? cols[kwIdx] : undefined,
      mention_type: "brand" as const,
    };
  }).filter((r) => r.url.startsWith("http"));
}

export function summarizeMentions(
  rows: CommunityMentionRow[],
  brand: string,
  competitors: string[]
): {
  total: number;
  byPlatform: Record<string, number>;
  brandMentions: number;
  competitorMentions: number;
  coverageScore: number;
} {
  const byPlatform: Record<string, number> = {};
  let brandMentions = 0;
  let competitorMentions = 0;

  for (const r of rows) {
    byPlatform[r.platform] = (byPlatform[r.platform] || 0) + 1;
    const text = `${r.url} ${r.keyword || ""}`.toLowerCase();
    if (text.includes(brand.toLowerCase())) brandMentions++;
    for (const c of competitors) {
      if (text.includes(c.toLowerCase())) competitorMentions++;
    }
  }

  const coverageScore = rows.length
    ? Math.min(100, Math.round((brandMentions / Math.max(rows.length, 1)) * 100))
    : 0;

  return {
    total: rows.length,
    byPlatform,
    brandMentions,
    competitorMentions,
    coverageScore,
  };
}
