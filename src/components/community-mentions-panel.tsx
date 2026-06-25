"use client";

import { useState } from "react";

interface CommunitySummary {
  total: number;
  brandMentions: number;
  competitorMentions: number;
  coverageScore: number;
  byPlatform: Record<string, number>;
}

export function CommunityMentionsPanel({ projectId }: { projectId: string }) {
  const [csv, setCsv] = useState("");
  const [summary, setSummary] = useState<CommunitySummary | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadStats() {
    const res = await fetch(`/api/community?projectId=${projectId}`);
    const data = await res.json();
    setSummary(data.summary || null);
  }

  async function importCsv() {
    setLoading(true);
    await fetch("/api/community", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, csv }),
    });
    await loadStats();
    setLoading(false);
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <h3 className="font-semibold">Reddit & Quora Mentions</h3>
      <p className="text-sm text-muted-foreground">Import CSV: platform, url, keyword</p>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={"platform,url,keyword\nreddit,https://reddit.com/r/...,best plumber"}
        rows={4}
        className="w-full font-mono text-sm bg-background border border-input rounded p-2"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={importCsv}
          disabled={loading || !csv.trim()}
          className="bg-primary text-primary-foreground px-3 py-2 rounded text-sm disabled:opacity-50"
        >
          Import mentions
        </button>
        <button type="button" onClick={loadStats} className="border border-border px-3 py-2 rounded text-sm">
          Load stats
        </button>
      </div>
      {summary && (
        <dl className="grid grid-cols-2 gap-2 text-sm mt-2">
          <dt className="text-muted-foreground">Total mentions</dt>
          <dd>{summary.total}</dd>
          <dt className="text-muted-foreground">Brand mentions</dt>
          <dd>{summary.brandMentions}</dd>
          <dt className="text-muted-foreground">Competitor mentions</dt>
          <dd>{summary.competitorMentions}</dd>
          <dt className="text-muted-foreground">Coverage score</dt>
          <dd>{summary.coverageScore}%</dd>
        </dl>
      )}
    </div>
  );
}
