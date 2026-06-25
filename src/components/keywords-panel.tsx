"use client";

import { useEffect, useState } from "react";

interface KeywordRow {
  id?: string;
  keyword: string;
  volume_estimate?: number;
  difficulty?: number;
  intent?: string;
  our_position?: number | null;
  opportunity_score: number;
}

interface GapRow {
  keyword: string;
  competitor_domain: string;
  competitor_position: number;
  our_position?: number | null;
  opportunity_score: number;
}

interface KeywordsPanelProps {
  projectId: string;
  industry?: string;
}

export function KeywordsPanel({ projectId, industry = "" }: KeywordsPanelProps) {
  const [opportunities, setOpportunities] = useState<KeywordRow[]>([]);
  const [gaps, setGaps] = useState<GapRow[]>([]);
  const [backlinkGaps, setBacklinkGaps] = useState<
    Array<{ source_domain: string; links_competitors: string[]; opportunity_score: number }>
  >([]);
  const [seed, setSeed] = useState(industry);
  const [loading, setLoading] = useState("");
  const [live, setLive] = useState<boolean | null>(null);

  async function load() {
    const res = await fetch(`/api/keywords?projectId=${projectId}`);
    const data = await res.json();
    setOpportunities(data.opportunities || []);
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/keywords?projectId=${projectId}`)
      .then((r) => r.json())
      .then((data) => {
        if (active) setOpportunities(data.opportunities || []);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  async function runResearch() {
    setLoading("research");
    const res = await fetch("/api/keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, seed: seed || industry }),
    });
    const data = await res.json();
    setOpportunities(data.opportunities || []);
    setLive(data.live);
    setLoading("");
  }

  async function runContentGaps() {
    setLoading("gaps");
    const res = await fetch("/api/keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "content_gaps" }),
    });
    const data = await res.json();
    setGaps(data.gaps || []);
    setLive(data.live);
    setLoading("");
  }

  async function runBacklinkGaps() {
    setLoading("backlinks");
    const res = await fetch("/api/keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "backlink_gaps" }),
    });
    const data = await res.json();
    setBacklinkGaps(data.gaps || []);
    setLive(data.live);
    setLoading("");
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-2">Keyword Intelligence</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Live research via OmniData: autocomplete clusters, SERP difficulty, and opportunity scoring from real rankings.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="Seed topic or industry"
            className="flex-1 min-w-[180px] bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={runResearch}
            disabled={loading === "research"}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {loading === "research" ? "Researching..." : "Research keywords"}
          </button>
          <button
            type="button"
            onClick={runContentGaps}
            disabled={loading === "gaps"}
            className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {loading === "gaps" ? "Analyzing..." : "Content gaps"}
          </button>
          <button
            type="button"
            onClick={runBacklinkGaps}
            disabled={loading === "backlinks"}
            className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {loading === "backlinks" ? "Scanning..." : "Backlink gaps"}
          </button>
        </div>
        {live === false && (
          <p className="text-xs text-yellow-400 mt-3">
            Live intelligence requires OMNIDATA_BASE_URL + SERPER_API_KEY (or deploy OmniData on VPS).
          </p>
        )}
      </div>

      {opportunities.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border font-semibold">Keyword opportunities</div>
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-muted-foreground">
              <tr>
                <th className="text-left p-3">Keyword</th>
                <th className="text-right p-3">Score</th>
                <th className="text-right p-3">Difficulty</th>
                <th className="text-right p-3">Position</th>
                <th className="text-left p-3">Intent</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.slice(0, 25).map((row) => (
                <tr key={row.keyword} className="border-t border-border/50">
                  <td className="p-3">{row.keyword}</td>
                  <td className="p-3 text-right text-primary">{row.opportunity_score}</td>
                  <td className="p-3 text-right">{row.difficulty ?? "—"}</td>
                  <td className="p-3 text-right">{row.our_position ?? "—"}</td>
                  <td className="p-3 text-muted-foreground">{row.intent ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h4 className="font-semibold mb-3">Content gaps (competitor ranks, you don&apos;t)</h4>
          <ul className="space-y-2 text-sm max-h-64 overflow-y-auto">
            {gaps.slice(0, 15).map((g) => (
              <li key={`${g.keyword}-${g.competitor_domain}`} className="flex justify-between gap-2">
                <span>
                  <span className="font-medium">{g.keyword}</span>
                  <span className="text-muted-foreground"> — {g.competitor_domain} #{g.competitor_position}</span>
                </span>
                <span className="text-primary shrink-0">{g.opportunity_score}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {backlinkGaps.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h4 className="font-semibold mb-3">Backlink gaps (competitors linked, you aren&apos;t)</h4>
          <ul className="space-y-2 text-sm max-h-64 overflow-y-auto">
            {backlinkGaps.slice(0, 15).map((g) => (
              <li key={g.source_domain} className="flex justify-between gap-2">
                <span>{g.source_domain}</span>
                <span className="text-muted-foreground shrink-0">{g.links_competitors.join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
