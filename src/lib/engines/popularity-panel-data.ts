/**
 * SimilarWeb-style popularity panel data — Tranco + rank.to + CCWG PageRank history.
 */
import { getDomainAuthority } from "@/lib/providers/tranco";
import { getRankToRank } from "@/lib/providers/rankto";
import { getCcWebGraphAuthority } from "@/lib/providers/ccwebgraph";
import { resolveDomainAuthority } from "@/lib/providers/domain-authority";
import type { PopularityDomainRow } from "@/components/popularity-panel";

function clean(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
}

export async function buildPopularityPanelRows(
  brandDomain: string,
  competitors: string[],
  brandName?: string
): Promise<PopularityDomainRow[]> {
  const targets = [
    { domain: clean(brandDomain), label: brandName || brandDomain, isBrand: true },
    ...competitors.map((c) => ({ domain: clean(c), label: c, isBrand: false })),
  ].filter((t) => t.domain);

  const rows: PopularityDomainRow[] = [];
  for (const t of targets.slice(0, 8)) {
    const [tranco, rankto, ccwg, authority] = await Promise.all([
      getDomainAuthority(t.domain).catch(() => null),
      getRankToRank(t.domain).catch(() => null),
      getCcWebGraphAuthority(t.domain).catch(() => null),
      resolveDomainAuthority(t.domain).catch(() => null),
    ]);

    rows.push({
      domain: t.domain,
      label: t.label,
      isBrand: t.isBrand,
      trancoRank: tranco?.success && tranco.data?.trancoRank ? tranco.data.trancoRank : undefined,
      globalRank: rankto?.available ? rankto.rank : authority?.globalRank,
      authorityScore: authority?.score ?? 0,
      authoritySource: authority?.source ?? "unlisted",
      pageRankNorm: ccwg?.pageRankNorm,
      trend: ccwg?.history?.slice(-6).map((h) => ({
        label: h.year_month,
        pageRank: h.pr_val_norm,
        harmonicCentrality: h.hc_val_norm,
      })),
    });
  }

  return rows.sort((a, b) => b.authorityScore - a.authorityScore);
}
