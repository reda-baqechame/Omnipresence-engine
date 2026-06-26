import { getCompetitiveSnapshot, type CompetitiveSnapshot } from "@/lib/engines/competitive-snapshot";

/**
 * Server component: the head-to-head competitive matrix incumbents charge for,
 * built entirely from free signals with honest labels — Popularity Index
 * (relative, not visits), Authority Rating (DR-style blend), real-user Core Web
 * Vitals (CrUX), and best-effort tech-stack fingerprints.
 */
export async function CompetitorIntel({
  domain,
  competitors,
  brandName,
}: {
  domain: string;
  competitors: string[];
  brandName?: string;
}) {
  const targets = [domain, ...competitors.slice(0, 4)].filter(Boolean);
  const snapshots = await Promise.all(
    targets.map((t, i) =>
      safeSnapshot(t, { name: i === 0 ? brandName : undefined, includeWiki: i === 0, includeCwv: true })
    )
  );

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Competitive Matrix</h3>
        <span className="text-xs text-muted-foreground">
          Free signals · relative popularity (not visits) · best-effort fingerprints
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="p-2 text-left">Domain</th>
              <th className="p-2 text-right" title="Relative popularity (rank.to + Tranco + Common Crawl + Wikipedia + age) — NOT visit counts">Popularity</th>
              <th className="p-2 text-right" title="Authority Rating: Tranco + Common Crawl referring domains + OpenPageRank + domain age">Authority</th>
              <th className="p-2 text-right" title="rank.to global rank (lower = more popular)">Global rank</th>
              <th className="p-2 text-left" title="Real-user Core Web Vitals from Chrome UX Report">CWV (field)</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((s, i) => (
              <tr key={s.target} className="border-b border-border/40">
                <td className="p-2">
                  <span className="font-medium">{cleanLabel(s.target)}</span>
                  {i === 0 && (
                    <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase text-primary">You</span>
                  )}
                </td>
                <td className="p-2 text-right">{s.popularity.score > 0 ? `${s.popularity.score}/100` : "—"}</td>
                <td className="p-2 text-right">{s.authority.rating > 0 ? `${s.authority.rating}/100` : "—"}</td>
                <td className="p-2 text-right">
                  {typeof s.popularity.globalRank === "number" ? (
                    <span>#{s.popularity.globalRank.toLocaleString()} {trendArrow(s.popularity.rankTrend)}</span>
                  ) : "—"}
                </td>
                <td className="p-2">{cwvBadge(s.cwv?.assessment)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {snapshots.map((s, i) => (
          <div key={s.target} className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="truncate">{cleanLabel(s.target)}</span>
              {i === 0 && (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase text-primary">You</span>
              )}
            </div>
            {s.techAvailable ? (
              <div className="mt-2 space-y-1.5">
                {Object.entries(s.techCategories).map(([cat, names]) => (
                  <div key={cat} className="text-xs">
                    <span className="text-muted-foreground">{cat}: </span>
                    <span>{names.join(", ")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                No public tech fingerprints detected (or site blocked the probe).
              </p>
            )}
          </div>
        ))}
      </div>

      <p className="mt-3 text-[10px] text-muted-foreground">
        Popularity Index is a relative proxy from public signals, not an absolute visit count.
        Authority is a free-signal blend (not Ahrefs DR). CWV reflects real Chrome users when a site has enough traffic.
      </p>
    </div>
  );
}

async function safeSnapshot(
  target: string,
  opts: { name?: string; includeWiki?: boolean; includeCwv?: boolean }
): Promise<CompetitiveSnapshot> {
  try {
    return await getCompetitiveSnapshot(target, opts);
  } catch {
    return {
      target,
      domain: cleanLabel(target),
      popularity: { score: 0, signals: [] },
      authority: { rating: 0, sources: [] },
      techCategories: {},
      techAvailable: false,
      components: { tranco: 0, referringDomains: 0, ageYears: 0, wikiViews: 0 },
    };
  }
}

function trendArrow(trend?: string): string {
  if (trend === "up") return "▲";
  if (trend === "down") return "▼";
  return "";
}

function cwvBadge(assessment?: string) {
  const map: Record<string, { label: string; cls: string }> = {
    good: { label: "Good", cls: "bg-green-500/15 text-green-400" },
    "needs-improvement": { label: "Needs work", cls: "bg-yellow-500/15 text-yellow-400" },
    poor: { label: "Poor", cls: "bg-red-500/15 text-red-400" },
  };
  const v = assessment ? map[assessment] : undefined;
  if (!v) return <span className="text-muted-foreground">no field data</span>;
  return <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${v.cls}`}>{v.label}</span>;
}

function cleanLabel(t: string): string {
  return t.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}
