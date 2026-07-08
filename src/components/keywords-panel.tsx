"use client";

import { useEffect, useState } from "react";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { MetricGlossary } from "@/components/metric-glossary";
import { DataTableToolbar } from "@/components/data-table-toolbar";
import { PanelError } from "@/components/panel-states";

const KEYWORD_COLUMNS = [
  { id: "keyword" as const, label: "Keyword" },
  { id: "score" as const, label: "Score" },
  { id: "volume" as const, label: "Volume" },
  { id: "demand" as const, label: "Demand" },
  { id: "difficulty" as const, label: "Difficulty" },
  { id: "position" as const, label: "Position" },
  { id: "intent" as const, label: "Intent" },
];
type KeywordCol = (typeof KEYWORD_COLUMNS)[number]["id"];

interface KeywordRow {
  id?: string;
  keyword: string;
  volume_estimate?: number;
  /** Honest log-scale bucket e.g. "1K–10K". */
  volume_range?: string;
  volume_confidence?: "low" | "medium" | "high";
  /** Relative Google Trends demand index (0-100), not absolute volume. */
  trend_index?: number;
  difficulty?: number;
  /** ranking_authority = real (authority of ranking pages); heuristic = fallback. */
  difficulty_method?: "ranking_authority" | "heuristic";
  intent?: string;
  our_position?: number | null;
  opportunity_score: number;
  data_source?: "measured" | "unavailable" | "estimated" | "model_knowledge" | "simulated";
  confidence?: number;
  last_checked_at?: string;
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-green-500/15 text-green-400",
  medium: "bg-yellow-500/15 text-yellow-400",
  low: "bg-muted text-muted-foreground",
};

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
  const [bulkSeeds, setBulkSeeds] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [loading, setLoading] = useState("");
  const [live, setLive] = useState<boolean | null>(null);
  const [universe, setUniverse] = useState<{
    total: number;
    byIntent: Record<string, number>;
    questions: string[];
    keywords: Array<{ keyword: string; intent: string; sources: string[]; rising: boolean }>;
  } | null>(null);
  const [visibleCols, setVisibleCols] = useState<KeywordCol[]>(KEYWORD_COLUMNS.map((c) => c.id));
  const [searchQ, setSearchQ] = useState("");
  const [intentFilter, setIntentFilter] = useState("all");
  const [loadError, setLoadError] = useState<string | null>(null);

  const filteredOpportunities = opportunities.filter((row) => {
    if (searchQ && !row.keyword.toLowerCase().includes(searchQ.toLowerCase())) return false;
    if (intentFilter !== "all" && row.intent !== intentFilter) return false;
    return true;
  });

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
      })
      .catch(() => {
        if (active) setLoadError("Couldn't load keyword data. Check your connection and reload.");
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

  async function runBulkResearch() {
    const seedList = bulkSeeds
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!seedList.length) return;
    setLoading("bulk");
    setBulkStatus(`Researching ${seedList.length} seeds…`);
    const res = await fetch("/api/keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "bulk_research", seeds: seedList }),
    });
    const data = await res.json();
    setOpportunities(data.opportunities || []);
    setLive(data.live);
    setBulkStatus(
      data.count != null
        ? `Found ${data.count} keywords across ${data.processed} seeds (${data.saved} saved).`
        : "Bulk research failed."
    );
    setLoading("");
  }

  async function runUniverse() {
    setLoading("universe");
    const res = await fetch("/api/keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "universe", seed: seed || industry }),
    });
    const data = await res.json();
    setUniverse(data.available ? data : null);
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
      {loadError && <PanelError title="Keyword data unavailable" message={loadError} />}
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
            onClick={runUniverse}
            disabled={loading === "universe"}
            className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            title="Keyless multi-source autocomplete + question/related expansion"
          >
            {loading === "universe" ? "Building…" : "Keyword universe"}
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

        <div className="mt-4 border-t border-border/60 pt-4">
          <h4 className="text-sm font-medium mb-1">Bulk research</h4>
          <p className="text-xs text-muted-foreground mb-2">
            Paste multiple seeds (comma or newline separated). Builds a large deduped keyword universe from all seeds at once.
          </p>
          <textarea
            value={bulkSeeds}
            onChange={(e) => setBulkSeeds(e.target.value)}
            placeholder={"seo tools\nai visibility\ncontent marketing\n..."}
            rows={3}
            className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-3 mt-2">
            <button
              type="button"
              onClick={runBulkResearch}
              disabled={loading === "bulk" || !bulkSeeds.trim()}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {loading === "bulk" ? "Running bulk job…" : "Run bulk research"}
            </button>
            {bulkStatus && <span className="text-xs text-muted-foreground">{bulkStatus}</span>}
          </div>
        </div>
      </div>

      {universe && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">Keyword universe ({universe.total})</h4>
            <div className="flex gap-2 text-xs text-muted-foreground">
              {Object.entries(universe.byIntent).map(([intent, n]) => (
                <span key={intent} className="rounded bg-secondary/40 px-2 py-0.5 capitalize">{intent}: {n}</span>
              ))}
            </div>
          </div>
          {universe.questions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">People-also-ask style questions</p>
              <div className="flex flex-wrap gap-1.5">
                {universe.questions.slice(0, 20).map((q) => (
                  <span key={q} className="rounded-full bg-secondary/40 px-2.5 py-1 text-xs">{q}</span>
                ))}
              </div>
            </div>
          )}
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left p-2">Keyword</th>
                  <th className="text-left p-2">Intent</th>
                  <th className="text-left p-2">Sources</th>
                </tr>
              </thead>
              <tbody>
                {universe.keywords.slice(0, 200).map((k) => (
                  <tr key={k.keyword} className="border-t border-border/50">
                    <td className="p-2">{k.keyword} {k.rising && <span className="text-green-400 text-xs">↑rising</span>}</td>
                    <td className="p-2 text-muted-foreground capitalize">{k.intent}</td>
                    <td className="p-2 text-xs text-muted-foreground">{k.sources.length}× {k.sources.slice(0, 3).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {opportunities.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border font-semibold">Keyword opportunities</div>
          <div className="px-4 pt-3">
            <DataTableToolbar
              storageKey={`kw-cols-${projectId}`}
              columns={KEYWORD_COLUMNS}
              filters={[
                { id: "all", label: "All intents" },
                { id: "informational", label: "Informational" },
                { id: "commercial", label: "Commercial" },
                { id: "transactional", label: "Transactional" },
                { id: "navigational", label: "Navigational" },
              ]}
              onColumnsChange={setVisibleCols}
              onFilterChange={setIntentFilter}
              searchPlaceholder="Filter keywords…"
              onSearchChange={setSearchQ}
            />
          </div>
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-muted-foreground">
              <tr>
                {visibleCols.includes("keyword") && <th className="text-left p-3">Keyword</th>}
                {visibleCols.includes("score") && <th className="text-right p-3">Score</th>}
                {visibleCols.includes("volume") && (
                  <th className="text-left p-3" title="Monthly search volume is shown only when a provider returned high-confidence measured data. Otherwise the field is unavailable, not estimated.">Volume</th>
                )}
                {visibleCols.includes("demand") && (
                  <th className="text-right p-3" title="Relative Google Trends demand (0-100), not absolute volume">Demand</th>
                )}
                {visibleCols.includes("difficulty") && <th className="text-right p-3">Difficulty</th>}
                {visibleCols.includes("position") && <th className="text-right p-3">Position</th>}
                {visibleCols.includes("intent") && <th className="text-left p-3">Intent</th>}
              </tr>
            </thead>
            <tbody>
              {filteredOpportunities.slice(0, 50).map((row) => (
                <tr key={row.keyword} className="border-t border-border/50">
                  {visibleCols.includes("keyword") && (
                  <td className="p-3">
                    {row.keyword}
                    <EvidenceDrawer projectId={projectId} capability="keyword" target={row.keyword} className="ml-1" />
                    {row.volume_confidence && (
                      <ProvenanceBadge
                        quality={row.data_source ?? (row.volume_confidence === "high" ? "measured" : "unavailable")}
                        confidence={row.confidence}
                        lastCheckedAt={row.last_checked_at}
                        className="ml-1"
                      />
                    )}
                  </td>
                  )}
                  {visibleCols.includes("score") && (
                  <td className="p-3 text-right text-primary">{row.opportunity_score}</td>
                  )}
                  {visibleCols.includes("volume") && (
                  <td className="p-3">
                    {row.volume_confidence === "high" && row.volume_range && row.volume_range !== "n/a" ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span>{row.volume_range}</span>
                        {row.volume_confidence && (
                          <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${CONFIDENCE_STYLE[row.volume_confidence]}`}>
                            {row.volume_confidence}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not measured</span>
                    )}
                  </td>
                  )}
                  {visibleCols.includes("demand") && (
                  <td className="p-3 text-right">
                    {typeof row.trend_index === "number" ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-1.5 w-10 rounded bg-muted align-middle">
                          <span
                            className="block h-1.5 rounded bg-primary"
                            style={{ width: `${row.trend_index}%` }}
                          />
                        </span>
                        <span className="text-xs text-muted-foreground">{row.trend_index}</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  )}
                  {visibleCols.includes("difficulty") && (
                  <td className="p-3 text-right">
                    {row.difficulty != null ? (
                      <span
                        className="inline-flex items-center gap-1"
                        title={
                          row.difficulty_method === "ranking_authority"
                            ? "Real KD — from the authority of the domains currently ranking"
                            : "Heuristic difficulty (no SERP authority available)"
                        }
                      >
                        {row.difficulty}
                        {row.difficulty_method === "ranking_authority" && (
                          <span className="rounded bg-green-500/15 px-1 py-0.5 text-[9px] uppercase text-green-400">real</span>
                        )}
                      </span>
                    ) : "—"}
                  </td>
                  )}
                  {visibleCols.includes("position") && (
                  <td className="p-3 text-right">{row.our_position ?? "—"}</td>
                  )}
                  {visibleCols.includes("intent") && (
                  <td className="p-3 text-muted-foreground">{row.intent ?? "—"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <MetricGlossary keys={["volume_confidence", "difficulty_real"]} className="p-4 border-t border-border" />
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
