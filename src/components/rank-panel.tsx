"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import { DataTableToolbar } from "@/components/data-table-toolbar";
import { PanelError } from "@/components/panel-states";

const RANK_COLUMNS = [
  { id: "keyword" as const, label: "Keyword" },
  { id: "position" as const, label: "Position" },
  { id: "source" as const, label: "Source" },
  { id: "delta" as const, label: "Delta" },
  { id: "device" as const, label: "Device" },
  { id: "sov" as const, label: "SoV" },
  { id: "aio" as const, label: "AIO" },
  { id: "features" as const, label: "Features" },
  { id: "history" as const, label: "History" },
];
type RankCol = (typeof RANK_COLUMNS)[number]["id"];

interface CompetitorOverlayEntry {
  domain: string;
  position: number | null;
}

interface RankKeyword {
  id: string;
  keyword: string;
  location: string;
  device?: string;
  last_position: number | null;
  is_striking_distance: boolean;
  last_checked_at: string | null;
  last_serp_features?: string[];
  cannibalization_urls?: Array<{ url: string; position: number }>;
  competitor_overlay?: CompetitorOverlayEntry[];
  share_of_voice?: number | null;
  brand_in_ai_overview?: boolean | null;
  last_rank_source?: string | null;
  last_confidence?: number | null;
  last_public_position?: number | null;
}

interface RankSnapshot {
  keyword_id: string;
  position: number | null;
  checked_at: string;
}

interface RankAlert {
  id: string;
  keyword: string;
  previous_position: number | null;
  current_position: number | null;
  delta: number | null;
}

interface RankPanelProps {
  projectId: string;
}

export function RankPanel({ projectId }: RankPanelProps) {
  const [keywords, setKeywords] = useState<RankKeyword[]>([]);
  const [snapshots, setSnapshots] = useState<RankSnapshot[]>([]);
  const [alerts, setAlerts] = useState<RankAlert[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newKeyword, setNewKeyword] = useState("");
  const [location, setLocation] = useState("United States");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [loading, setLoading] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [rankFilter, setRankFilter] = useState("all");
  const [visibleCols, setVisibleCols] = useState<RankCol[]>(RANK_COLUMNS.map((c) => c.id));
  const [loadError, setLoadError] = useState<string | null>(null);

  const filteredKeywords = useMemo(() => {
    return keywords.filter((k) => {
      if (searchQ && !k.keyword.toLowerCase().includes(searchQ.toLowerCase())) return false;
      if (rankFilter === "striking" && !k.is_striking_distance) return false;
      if (rankFilter === "top10" && (k.last_position == null || k.last_position > 10)) return false;
      if (rankFilter === "unranked" && k.last_position != null) return false;
      return true;
    });
  }, [keywords, searchQ, rankFilter]);

  async function load() {
    const res = await fetch(`/api/ranks?projectId=${projectId}`);
    const data = await res.json();
    setKeywords(data.keywords || []);
    setSnapshots(data.snapshots || []);
    setAlerts(data.alerts || []);
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/ranks?projectId=${projectId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        setKeywords(data.keywords || []);
        setSnapshots(data.snapshots || []);
        setAlerts(data.alerts || []);
      })
      .catch(() => {
        if (active) setLoadError("Couldn't load ranking data. Check your connection and reload.");
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  function historyFor(keywordId: string) {
    return snapshots
      .filter((s) => s.keyword_id === keywordId)
      .sort((a, b) => new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime())
      .slice(0, 12);
  }

  function positionDelta(keywordId: string): number | null {
    const hist = historyFor(keywordId);
    if (hist.length < 2 || hist[0].position == null || hist[1].position == null) return null;
    return hist[0].position - hist[1].position;
  }

  async function post(body: Record<string, unknown>) {
    setLoading(true);
    await fetch("/api/ranks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, ...body }),
    });
    await load();
    setLoading(false);
  }

  async function addKeyword() {
    if (!newKeyword.trim()) return;
    await post({ keyword: newKeyword, location, device });
    setNewKeyword("");
  }

  async function ackAlert(alertId: string) {
    await post({ action: "ack_alert", alertId });
  }

  return (
    <div className="space-y-6">
      {loadError && <PanelError title="Ranking data unavailable" message={loadError} />}
      {alerts.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <h3 className="font-semibold text-sm text-red-400 mb-2">Rank drops ({alerts.length})</h3>
          <div className="space-y-1">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm">
                <span>
                  <strong>{a.keyword}</strong>: #{a.previous_position ?? "—"} → #{a.current_position ?? "lost"}
                  {a.delta != null && <span className="text-red-400"> ({a.delta > 0 ? "+" : ""}{a.delta})</span>}
                </span>
                <button onClick={() => ackAlert(a.id)} className="text-xs text-muted-foreground hover:text-foreground">
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-3">Rank Tracker</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Per-device, per-location tracking with SERP features, competitor overlay, share-of-voice,
          cannibalization, and brand-in-AI-Overview. History stored per check.
        </p>
        <div className="flex gap-2 flex-wrap">
          <input
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder="Add keyword to track"
            className="flex-1 min-w-[180px] bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location (e.g. Austin, Texas)"
            className="w-48 bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <select
            aria-label="Device"
            value={device}
            onChange={(e) => setDevice(e.target.value as "desktop" | "mobile")}
            className="bg-background border border-input rounded-lg px-3 py-2 text-sm"
          >
            <option value="desktop">Desktop</option>
            <option value="mobile">Mobile</option>
          </select>
          <button type="button" onClick={addKeyword} disabled={loading} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50">
            Track
          </button>
          <button type="button" onClick={() => post({ action: "import_prompts" })} disabled={loading} className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50">
            Import from prompts
          </button>
          <button type="button" onClick={() => post({ action: "check_all" })} disabled={loading} className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50">
            Check all ranks
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        <div className="p-4 border-b border-border">
          <DataTableToolbar
            storageKey={`rank-cols-${projectId}`}
            columns={RANK_COLUMNS}
            filters={[
              { id: "all", label: "All keywords" },
              { id: "striking", label: "Striking distance" },
              { id: "top10", label: "Top 10" },
              { id: "unranked", label: "Unranked" },
            ]}
            onColumnsChange={setVisibleCols}
            onFilterChange={setRankFilter}
            searchPlaceholder="Filter keywords…"
            onSearchChange={setSearchQ}
          />
        </div>
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr>
              {visibleCols.includes("keyword") && <th className="text-left p-3">Keyword</th>}
              {visibleCols.includes("position") && <th className="text-left p-3">Pos.</th>}
              {visibleCols.includes("source") && <th className="text-left p-3">Source</th>}
              {visibleCols.includes("delta") && <th className="text-left p-3">Δ</th>}
              {visibleCols.includes("device") && <th className="text-left p-3">Device</th>}
              {visibleCols.includes("sov") && <th className="text-left p-3">SoV</th>}
              {visibleCols.includes("aio") && <th className="text-left p-3">AIO</th>}
              {visibleCols.includes("features") && <th className="text-left p-3">Features</th>}
              {visibleCols.includes("history") && <th className="text-left p-3">History</th>}
            </tr>
          </thead>
          <tbody>
            {filteredKeywords.length === 0 ? (
              <tr>
                <td colSpan={visibleCols.length} className="p-4 text-muted-foreground">No keywords match this filter.</td>
              </tr>
            ) : (
              filteredKeywords.map((k) => {
                const delta = positionDelta(k.id);
                const hist = historyFor(k.id);
                return (
                  <Fragment key={k.id}>
                    <tr className="border-t border-border">
                      {visibleCols.includes("keyword") && (
                      <td className="p-3">
                        {k.keyword}
                        <EvidenceDrawer projectId={projectId} capability="rank" target={k.keyword} className="ml-1" />
                        <span className="block text-xs text-muted-foreground">{k.location}</span>
                      </td>
                      )}
                      {visibleCols.includes("position") && <td className="p-3">{k.last_position ?? "—"}</td>}
                      {visibleCols.includes("source") && (
                      <td className="p-3">
                        {k.last_rank_source === "first_party" ? (
                          <span
                            className="inline-flex items-center gap-1 rounded bg-green-500/15 px-1.5 py-0.5 text-xs text-green-400"
                            title={`Search Console first-party data${k.last_public_position != null ? ` · public SERP #${k.last_public_position}` : ""}`}
                          >
                            First-party
                          </span>
                        ) : k.last_rank_source === "public_serp" ? (
                          <span
                            className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-400"
                            title="Public SERP scrape — connect Search Console for first-party truth"
                          >
                            Public SERP
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      )}
                      {visibleCols.includes("delta") && (
                      <td className="p-3">
                        {delta == null ? "—" : (
                          <span className={delta < 0 ? "text-green-400" : delta > 0 ? "text-red-400" : ""}>
                            {delta > 0 ? "+" : ""}{delta}
                          </span>
                        )}
                      </td>
                      )}
                      {visibleCols.includes("device") && <td className="p-3 capitalize">{k.device || "desktop"}</td>}
                      {visibleCols.includes("sov") && <td className="p-3">{k.share_of_voice != null ? `${Math.round(k.share_of_voice * 100)}%` : "—"}</td>}
                      {visibleCols.includes("aio") && <td className="p-3">{k.brand_in_ai_overview == null ? "—" : k.brand_in_ai_overview ? "✓" : "✗"}</td>}
                      {visibleCols.includes("features") && (
                      <td className="p-3 text-xs text-muted-foreground">
                        {(k.last_serp_features || []).slice(0, 3).join(", ") || "—"}
                      </td>
                      )}
                      {visibleCols.includes("history") && (
                      <td className="p-3">
                        {hist.length > 0 ? (
                          <button type="button" className="text-primary text-xs" onClick={() => setExpanded(expanded === k.id ? null : k.id)}>
                            {expanded === k.id ? "Hide" : `${hist.length} checks`}
                          </button>
                        ) : "—"}
                      </td>
                      )}
                    </tr>
                    {expanded === k.id && (
                      <tr className="border-t border-border bg-secondary/20">
                        <td colSpan={visibleCols.length} className="p-3 text-xs space-y-2">
                          <div>
                            <span className="text-muted-foreground">History: </span>
                            {hist.map((h) => (
                              <span key={h.checked_at} className="inline-block mr-3">
                                {new Date(h.checked_at).toLocaleDateString()}: #{h.position ?? "—"}
                              </span>
                            ))}
                          </div>
                          {(k.competitor_overlay || []).length > 0 && (
                            <div>
                              <span className="text-muted-foreground">Competitors: </span>
                              {(k.competitor_overlay || []).map((c) => (
                                <span key={c.domain} className="inline-block mr-3">
                                  {c.domain}: #{c.position ?? "—"}
                                </span>
                              ))}
                            </div>
                          )}
                          {(k.cannibalization_urls || []).length > 0 && (
                            <div className="text-yellow-400">
                              Cannibalization: {(k.cannibalization_urls || []).map((c) => `${c.url} (#${c.position})`).join(", ")}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
