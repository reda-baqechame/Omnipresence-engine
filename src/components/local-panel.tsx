"use client";

import { useEffect, useState } from "react";

interface GbpCheck {
  label: string;
  ok: boolean;
  recommendation?: string;
}
interface GbpAudit {
  available: boolean;
  reason?: string;
  matched?: { title?: string; rating?: number; ratingCount?: number; address?: string };
  checks: GbpCheck[];
  completeness: number;
}
interface GridCell {
  row: number;
  col: number;
  rank: number | null;
}
interface MapGrid {
  available: boolean;
  reason?: string;
  keyword: string;
  gridSize: number;
  cells: GridCell[];
  avgRank: number | null;
  foundCells: number;
  totalCells: number;
}

function rankColor(rank: number | null): string {
  if (rank == null) return "bg-muted text-muted-foreground";
  if (rank <= 3) return "bg-green-500 text-white";
  if (rank <= 10) return "bg-yellow-500 text-black";
  return "bg-red-500 text-white";
}

export function LocalPanel({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState("");
  const [audit, setAudit] = useState<GbpAudit | null>(null);
  const [grid, setGrid] = useState<MapGrid | null>(null);
  const [keyword, setKeyword] = useState("");
  const [reviews, setReviews] = useState<{ rating: number | null; review_count: number | null; captured_at: string }[]>([]);
  const [service, setService] = useState("");
  const [city, setCity] = useState("");
  const [page, setPage] = useState<{ title: string; markdown: string; jsonLd: unknown } | null>(null);
  const [nap, setNap] = useState<{ available: boolean; reason?: string; canonical?: { name?: string; address?: string; phone?: string }; directories: { name: string; url: string; action: string }[] } | null>(null);
  const [osm, setOsm] = useState<{
    available: boolean;
    reason?: string;
    center?: { displayName: string };
    competitors: Array<{ name: string; category: string; website?: string }>;
    citationSources: { name: string; url: string; action: string }[];
  } | null>(null);
  const [osmCategory, setOsmCategory] = useState("");

  useEffect(() => {
    fetch(`/api/local?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setReviews(d.reviews || []));
  }, [projectId]);

  async function post(action: string, extra?: Record<string, unknown>) {
    const res = await fetch("/api/local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action, ...extra }),
    });
    return res.json();
  }

  async function runAudit() {
    setLoading("audit");
    setAudit(await post("gbp_audit"));
    setLoading("");
  }
  async function runGrid() {
    if (!keyword.trim()) return;
    setLoading("grid");
    setGrid(await post("map_grid", { keyword }));
    setLoading("");
  }
  async function runReviews() {
    setLoading("reviews");
    await post("reviews");
    const d = await (await fetch(`/api/local?projectId=${projectId}`)).json();
    setReviews(d.reviews || []);
    setLoading("");
  }
  async function runNap() {
    setLoading("nap");
    setNap(await post("nap"));
    setLoading("");
  }
  async function runPage() {
    if (!service.trim() || !city.trim()) return;
    setLoading("page");
    setPage(await post("local_page", { service, city }));
    setLoading("");
  }
  async function runOsm() {
    setLoading("osm");
    setOsm(await post("osm_discovery", { category: osmCategory || undefined }));
    setLoading("");
  }

  return (
    <div className="space-y-6">
      {/* GBP audit */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Google Business Profile audit</h3>
          <button type="button" onClick={runAudit} disabled={loading === "audit"} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {loading === "audit" ? "Auditing…" : "Run audit"}
          </button>
        </div>
        {audit && (
          audit.available && audit.checks.length ? (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="text-2xl font-bold">{audit.completeness}%</div>
                <span className="text-sm text-muted-foreground">profile completeness{audit.matched?.title ? ` · ${audit.matched.title}` : ""}</span>
              </div>
              <ul className="space-y-1.5 text-sm">
                {audit.checks.map((c) => (
                  <li key={c.label} className="flex items-start gap-2">
                    <span className={c.ok ? "text-green-400" : "text-red-400"}>{c.ok ? "✓" : "✗"}</span>
                    <span>{c.label}{!c.ok && c.recommendation ? <span className="text-muted-foreground"> — {c.recommendation}</span> : null}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-yellow-400">{audit.reason}</p>
          )
        )}
      </div>

      {/* Map grid */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-2">Map-grid rank tracking</h3>
        <p className="text-sm text-muted-foreground mb-3">
          See how your local ranking varies by location (Local Falcon style). Green = top 3, yellow = top 10, red = 11+, grey = not found.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder='e.g. "plumber near me"' className="flex-1 min-w-[200px] bg-background border border-input rounded-lg px-3 py-2 text-sm" />
          <button type="button" onClick={runGrid} disabled={loading === "grid" || !keyword.trim()} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50">
            {loading === "grid" ? "Scanning grid…" : "Run grid scan"}
          </button>
        </div>
        {grid && (
          grid.available ? (
            <div>
              <div className="text-sm text-muted-foreground mb-2">
                Avg rank {grid.avgRank != null ? grid.avgRank.toFixed(1) : "—"} · found in {grid.foundCells}/{grid.totalCells} cells
              </div>
              <div
                className="inline-grid gap-1"
                style={{ gridTemplateColumns: `repeat(${grid.gridSize}, minmax(0, 1fr))` }}
              >
                {grid.cells.map((c) => (
                  <div key={`${c.row}-${c.col}`} className={`h-9 w-9 rounded flex items-center justify-center text-xs font-medium ${rankColor(c.rank)}`}>
                    {c.rank ?? "–"}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-yellow-400">{grid.reason}</p>
          )
        )}
      </div>

      {/* Reviews */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Review velocity</h3>
          <button type="button" onClick={runReviews} disabled={loading === "reviews"} className="border border-border px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {loading === "reviews" ? "Capturing…" : "Capture snapshot"}
          </button>
        </div>
        {reviews.length > 0 ? (
          <div className="text-sm">
            <div className="flex gap-6 mb-2">
              <div><span className="text-2xl font-bold">{reviews[0].rating ?? "—"}</span><span className="text-muted-foreground">★ rating</span></div>
              <div><span className="text-2xl font-bold">{reviews[0].review_count ?? "—"}</span><span className="text-muted-foreground"> reviews</span></div>
            </div>
            <div className="text-xs text-muted-foreground">{reviews.length} snapshot(s) tracked. Capture regularly to measure review velocity.</div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No snapshots yet. Capture one to start tracking review growth.</p>
        )}
      </div>

      {/* NAP */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">NAP consistency</h3>
          <button type="button" onClick={runNap} disabled={loading === "nap"} className="border border-border px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {loading === "nap" ? "Checking…" : "Check NAP"}
          </button>
        </div>
        {nap && (
          nap.available ? (
            <div className="text-sm">
              {nap.canonical && (
                <div className="mb-3 text-muted-foreground">
                  Canonical: <span className="text-foreground">{nap.canonical.name}</span>
                  {nap.canonical.address ? ` · ${nap.canonical.address}` : ""}
                  {nap.canonical.phone ? ` · ${nap.canonical.phone}` : ""}
                </div>
              )}
              <ul className="space-y-1">
                {nap.directories.map((d) => (
                  <li key={d.name} className="flex justify-between gap-2">
                    <a href={d.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{d.name}</a>
                    <span className="text-muted-foreground text-xs">{d.action}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-yellow-400">{nap.reason}</p>
          )
        )}
      </div>

      {/* Keyless local discovery via OpenStreetMap */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="font-semibold">Keyless local discovery (OpenStreetMap)</h3>
            <p className="text-xs text-muted-foreground">Geocodes your business (NAP) and finds nearby competitors — zero API keys.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          <input value={osmCategory} onChange={(e) => setOsmCategory(e.target.value)} placeholder="Category filter (e.g. dentist, plumber) — optional" className="flex-1 min-w-[200px] bg-background border border-input rounded-lg px-3 py-2 text-sm" />
          <button type="button" onClick={runOsm} disabled={loading === "osm"} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50">
            {loading === "osm" ? "Discovering…" : "Discover via OSM"}
          </button>
        </div>
        {osm && (
          osm.available ? (
            <div className="space-y-3 text-sm">
              {osm.center?.displayName && (
                <div className="text-muted-foreground">Anchor: <span className="text-foreground">{osm.center.displayName}</span></div>
              )}
              {osm.competitors.length > 0 && (
                <div>
                  <div className="font-medium mb-1">Nearby competitors ({osm.competitors.length})</div>
                  <ul className="space-y-1 max-h-56 overflow-auto">
                    {osm.competitors.slice(0, 40).map((c, i) => (
                      <li key={`${c.name}-${i}`} className="flex justify-between gap-2">
                        <span>{c.name} <span className="text-muted-foreground text-xs">· {c.category}</span></span>
                        {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer" className="text-primary text-xs hover:underline">site</a>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <div className="font-medium mb-1">Local citation checklist</div>
                <ul className="space-y-1">
                  {osm.citationSources.map((d) => (
                    <li key={d.name} className="flex justify-between gap-2">
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{d.name}</a>
                      <span className="text-muted-foreground text-xs">{d.action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-sm text-yellow-400">{osm.reason}</p>
          )
        )}
      </div>

      {/* Local landing page */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-2">Local landing-page generator</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          <input value={service} onChange={(e) => setService(e.target.value)} placeholder="Service (e.g. Drain Cleaning)" className="flex-1 min-w-[160px] bg-background border border-input rounded-lg px-3 py-2 text-sm" />
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City (e.g. Austin)" className="flex-1 min-w-[140px] bg-background border border-input rounded-lg px-3 py-2 text-sm" />
          <button type="button" onClick={runPage} disabled={loading === "page" || !service.trim() || !city.trim()} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50">
            {loading === "page" ? "Generating…" : "Generate page"}
          </button>
        </div>
        {page && (
          <div className="space-y-3">
            <div className="font-medium text-sm">{page.title}</div>
            <pre className="text-xs bg-background rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{page.markdown}</pre>
            <details>
              <summary className="text-sm cursor-pointer text-muted-foreground">LocalBusiness JSON-LD</summary>
              <pre className="text-xs bg-background rounded-lg p-3 overflow-x-auto mt-2">{JSON.stringify(page.jsonLd, null, 2)}</pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
