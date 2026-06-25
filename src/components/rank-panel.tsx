"use client";

import { useEffect, useState } from "react";

interface RankKeyword {
  id: string;
  keyword: string;
  location: string;
  last_position: number | null;
  is_striking_distance: boolean;
  last_checked_at: string | null;
}

interface RankPanelProps {
  projectId: string;
}

export function RankPanel({ projectId }: RankPanelProps) {
  const [keywords, setKeywords] = useState<RankKeyword[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch(`/api/ranks?projectId=${projectId}`);
    const data = await res.json();
    setKeywords(data.keywords || []);
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/ranks?projectId=${projectId}`)
      .then((res) => res.json())
      .then((data) => {
        if (active) setKeywords(data.keywords || []);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

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
        <div className="flex gap-2 flex-wrap">
          <input
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder="Add keyword to track"
            className="flex-1 min-w-[200px] bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={addKeyword}
            disabled={loading}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            Track
          </button>
          <button
            type="button"
            onClick={importPrompts}
            disabled={loading}
            className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            Import from prompts
          </button>
          <button
            type="button"
            onClick={checkAll}
            disabled={loading}
            className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
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
              <th className="text-left p-3">Striking distance</th>
              <th className="text-left p-3">Last checked</th>
            </tr>
          </thead>
          <tbody>
            {keywords.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-4 text-muted-foreground">
                  No keywords tracked yet.
                </td>
              </tr>
            ) : (
              keywords.map((k) => (
                <tr key={k.id} className="border-t border-border">
                  <td className="p-3">{k.keyword}</td>
                  <td className="p-3">{k.last_position ?? "—"}</td>
                  <td className="p-3">{k.is_striking_distance ? "Yes" : "No"}</td>
                  <td className="p-3 text-muted-foreground">
                    {k.last_checked_at ? new Date(k.last_checked_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
