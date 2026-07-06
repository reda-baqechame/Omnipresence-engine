import { getCompetitiveSnapshot, type CompetitiveSnapshot } from "@/lib/engines/competitive-snapshot";

/**
 * Side-by-side competitor comparison — domain overview practitioners expect from Ahrefs/Semrush.
 */
export async function CompetitorComparison({
  brandDomain,
  brandName,
  competitors,
}: {
  brandDomain: string;
  brandName: string;
  competitors: string[];
}) {
  const targets = [brandDomain, ...competitors.slice(0, 3)].filter(Boolean);
  const snapshots = await Promise.all(
    targets.map((domain, i) =>
      getCompetitiveSnapshot(domain, {
        name: i === 0 ? brandName : undefined,
        includeWiki: i === 0,
        includeCwv: i === 0,
      }).catch((): CompetitiveSnapshot | null => null)
    )
  );

  const valid = snapshots.filter((s): s is CompetitiveSnapshot => s !== null);
  if (valid.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Add competitors on the project to enable side-by-side comparison.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 overflow-x-auto">
      <h3 className="font-semibold mb-1">Side-by-side domain comparison</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Popularity and authority are relative proxies — not visit counts. CWV is field data for your domain only.
      </p>
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="text-muted-foreground border-b">
            <th className="text-left p-2">Metric</th>
            {valid.map((s) => (
              <th key={s.target} className="text-right p-2">
                {s.target.replace(/^www\./, "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            { label: "Popularity tier", get: (s: CompetitiveSnapshot) => (s.popularity.tier > 0 ? `${s.popularity.tier}/10` : "—") },
            { label: "Authority rating", get: (s: CompetitiveSnapshot) => (s.authority.rating > 0 ? `${s.authority.rating}/100` : "—") },
            { label: "Global rank", get: (s: CompetitiveSnapshot) => (s.popularity.globalRank ? `#${s.popularity.globalRank.toLocaleString()}` : "—") },
            { label: "CWV LCP (field)", get: (s: CompetitiveSnapshot) => (s.cwv?.lcpMs ? `${s.cwv.lcpMs}ms` : "—") },
          ].map((row) => (
            <tr key={row.label} className="border-b border-border/40">
              <td className="p-2 text-muted-foreground">{row.label}</td>
              {valid.map((s) => (
                <td key={`${row.label}-${s.target}`} className="p-2 text-right font-medium">
                  {row.get(s)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
