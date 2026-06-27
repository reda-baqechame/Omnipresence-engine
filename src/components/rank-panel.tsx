"use client";

import { Fragment, useEffect, useState } from "react";

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
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr>
              <th className="text-left p-3">Keyword</th>
              <th className="text-left p-3">Pos.</th>
              <th className="text-left p-3">Δ</th>
              <th className="text-left p-3">Device</th>
              <th className="text-left p-3">SoV</th>
              <th className="text-left p-3">AIO</th>
              <th className="text-left p-3">Features</th>
              <th className="text-left p-3">History</th>
            </tr>
          </thead>
          <tbody>
            {keywords.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-4 text-muted-foreground">No keywords tracked yet.</td>
              </tr>
            ) : (
              keywords.map((k) => {
                const delta = positionDelta(k.id);
                const hist = historyFor(k.id);
                return (
                  <Fragment key={k.id}>
                    <tr className="border-t border-border">
                      <td className="p-3">
                        {k.keyword}
                        <span className="block text-xs text-muted-foreground">{k.location}</span>
                      </td>
                      <td className="p-3">{k.last_position ?? "—"}</td>
                      <td className="p-3">
                        {delta == null ? "—" : (
                          <span className={delta < 0 ? "text-green-400" : delta > 0 ? "text-red-400" : ""}>
                            {delta > 0 ? "+" : ""}{delta}
                          </span>
                        )}
                      </td>
                      <td className="p-3 capitalize">{k.device || "desktop"}</td>
                      <td className="p-3">{k.share_of_voice != null ? `${Math.round(k.share_of_voice * 100)}%` : "—"}</td>
                      <td className="p-3">{k.brand_in_ai_overview == null ? "—" : k.brand_in_ai_overview ? "✓" : "✗"}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {(k.last_serp_features || []).slice(0, 3).join(", ") || "—"}
                      </td>
                      <td className="p-3">
                        {hist.length > 0 ? (
                          <button type="button" className="text-primary text-xs" onClick={() => setExpanded(expanded === k.id ? null : k.id)}>
                            {expanded === k.id ? "Hide" : `${hist.length} checks`}
                          </button>
                        ) : "—"}
                      </td>
                    </tr>
                    {expanded === k.id && (
                      <tr className="border-t border-border bg-secondary/20">
                        <td colSpan={8} className="p-3 text-xs space-y-2">
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
