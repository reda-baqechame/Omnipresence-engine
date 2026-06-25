"use client";

import { Fragment, useEffect, useState } from "react";

interface RankKeyword {
  id: string;
  keyword: string;
  location: string;
  last_position: number | null;
  is_striking_distance: boolean;
  last_checked_at: string | null;
}

interface RankSnapshot {
  keyword_id: string;
  position: number | null;
  checked_at: string;
}

interface RankPanelProps {
  projectId: string;
}

export function RankPanel({ projectId }: RankPanelProps) {
  const [keywords, setKeywords] = useState<RankKeyword[]>([]);
  const [snapshots, setSnapshots] = useState<RankSnapshot[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newKeyword, setNewKeyword] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch(`/api/ranks?projectId=${projectId}`);
    const data = await res.json();
    setKeywords(data.keywords || []);
    setSnapshots(data.snapshots || []);
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/ranks?projectId=${projectId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        setKeywords(data.keywords || []);
        setSnapshots(data.snapshots || []);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  function historyFor(keywordId: string) {
    return snapshots
      .filter((s) => s.keyword_id === keywordId)
      .sort((a, b) => new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime())
      .slice(0, 8);
  }

  function positionDelta(keywordId: string): number | null {
    const hist = historyFor(keywordId);
    if (hist.length < 2 || hist[0].position == null || hist[1].position == null) return null;
    return hist[0].position - hist[1].position;
  }

  async function addKeyword() {
    if (!newKeyword.trim()) return;
    setLoading(true);
    await fetch("/api/ranks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, keyword: newKeyword }),
    });
    setNewKeyword("");
    await load();
    setLoading(false);
  }

  async function checkAll() {
    setLoading(true);
    await fetch("/api/ranks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "check_all" }),
    });
    await load();
    setLoading(false);
  }

  async function importPrompts() {
    setLoading(true);
    await fetch("/api/ranks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "import_prompts" }),
    });
    await load();
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-3">Rank Tracker</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Position history stored per check. Weekly cron runs Tuesday 05:00 UTC. OmniData Redis history when deployed.
        </p>
        <div className="flex gap-2 flex-wrap">
          <input
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder="Add keyword to track"
            className="flex-1 min-w-[200px] bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <button type="button" onClick={addKeyword} disabled={loading} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50">
            Track
          </button>
          <button type="button" onClick={importPrompts} disabled={loading} className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50">
            Import from prompts
          </button>
          <button type="button" onClick={checkAll} disabled={loading} className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50">
            Check all ranks
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr>
              <th className="text-left p-3">Keyword</th>
              <th className="text-left p-3">Position</th>
              <th className="text-left p-3">Change</th>
              <th className="text-left p-3">Striking</th>
              <th className="text-left p-3">History</th>
            </tr>
          </thead>
          <tbody>
            {keywords.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-4 text-muted-foreground">No keywords tracked yet.</td>
              </tr>
            ) : (
              keywords.map((k) => {
                const delta = positionDelta(k.id);
                const hist = historyFor(k.id);
                return (
                  <Fragment key={k.id}>
                    <tr className="border-t border-border">
                      <td className="p-3">{k.keyword}</td>
                      <td className="p-3">{k.last_position ?? "—"}</td>
                      <td className="p-3">
                        {delta == null ? "—" : (
                          <span className={delta < 0 ? "text-green-400" : delta > 0 ? "text-red-400" : ""}>
                            {delta > 0 ? "+" : ""}{delta}
                          </span>
                        )}
                      </td>
                      <td className="p-3">{k.is_striking_distance ? "Yes" : "No"}</td>
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
                        <td colSpan={5} className="p-3 text-xs">
                          {hist.map((h) => (
                            <span key={h.checked_at} className="inline-block mr-3">
                              {new Date(h.checked_at).toLocaleDateString()}: #{h.position ?? "—"}
                            </span>
                          ))}
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
