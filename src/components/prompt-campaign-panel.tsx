"use client";

import { useState } from "react";
import type { PromptCategory } from "@/types/database";
import { MetricGlossary } from "@/components/metric-glossary";
import type { PromptDemandSignal } from "@/lib/engines/prompt-demand";

const CATEGORY_LABELS: Record<PromptCategory, string> = {
  best_of: "Best of",
  comparison: "Comparison",
  local: "Local",
  problem_aware: "Problem aware",
  solution_aware: "Solution aware",
  pricing: "Pricing",
  trust: "Trust",
  alternatives: "Alternatives",
  reviews: "Reviews",
  transactional: "Transactional",
};

interface PromptRow {
  id: string;
  text: string;
  category: PromptCategory;
  priority: number;
  is_tracked: boolean;
}

interface PromptCampaignPanelProps {
  projectId: string;
  hasGscConnection: boolean;
  initialPrompts: PromptRow[];
  demandSignals?: PromptDemandSignal[];
}

export function PromptCampaignPanel({
  projectId,
  hasGscConnection,
  initialPrompts,
  demandSignals = [],
}: PromptCampaignPanelProps) {
  const [prompts, setPrompts] = useState<PromptRow[]>(initialPrompts);
  const [csv, setCsv] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function reloadPrompts() {
    const res = await fetch(`/api/prompts?projectId=${projectId}`);
    const data = await res.json();
    setPrompts(data.prompts || []);
  }

  const byCategory = prompts.reduce(
    (acc, p) => {
      acc[p.category] = (acc[p.category] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  async function importCsv() {
    if (!csv.trim()) return;
    setLoading(true);
    setMessage(null);
    const res = await fetch("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, csv }),
    });
    const data = await res.json();
    setMessage(res.ok ? `Imported ${data.imported} prompts` : data.error || "Import failed");
    setLoading(false);
    if (res.ok) {
      setCsv("");
      reloadPrompts();
    }
  }

  async function importGsc() {
    setLoading(true);
    setMessage(null);
    const res = await fetch("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "import_gsc" }),
    });
    const data = await res.json();
    setMessage(res.ok ? `Imported ${data.imported} queries from GSC` : data.error || "GSC import failed");
    setLoading(false);
    if (res.ok) reloadPrompts();
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold">Prompt Campaign</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Scale to 300–1000 tracked prompts. Cluster by funnel category for coverage planning.
        </p>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-2xl font-bold text-primary">{prompts.length}</div>
          <div className="text-sm text-muted-foreground">Total prompts</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-2xl font-bold">{Object.keys(byCategory).length}</div>
          <div className="text-sm text-muted-foreground">Funnel categories</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 md:col-span-2">
          <div className="text-sm text-muted-foreground mb-2">By category</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(byCategory).map(([cat, count]) => (
              <span key={cat} className="text-xs bg-secondary px-2 py-1 rounded-full">
                {CATEGORY_LABELS[cat as PromptCategory] || cat}: {count}
              </span>
            ))}
            {prompts.length === 0 && (
              <span className="text-xs text-muted-foreground">Import prompts to see funnel clusters</span>
            )}
          </div>
        </div>
      </div>

      {demandSignals.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-semibold mb-2">Prompt demand (Profound-style)</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Relative query interest from Autocomplete breadth + Google Trends momentum — not absolute volume.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="p-2">Prompt</th>
                  <th className="p-2 text-right">Demand</th>
                  <th className="p-2 text-right">Momentum</th>
                  <th className="p-2">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {demandSignals.slice(0, 10).map((d) => (
                  <tr key={d.prompt} className="border-b border-border/40">
                    <td className="p-2 max-w-xs truncate" title={d.prompt}>{d.prompt}</td>
                    <td className="p-2 text-right tabular-nums">{d.demandIndex}/100</td>
                    <td className="p-2 text-right tabular-nums">{d.trendMomentum > 0 ? `+${d.trendMomentum}` : d.trendMomentum}</td>
                    <td className="p-2 capitalize text-xs">{d.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MetricGlossary keys={["prompt_demand"]} className="mt-3 pt-3 border-t border-border" />
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <h3 className="font-semibold">Bulk CSV import</h3>
        <p className="text-sm text-muted-foreground">
          One prompt per line: <code className="text-xs">text,category,priority</code>
        </p>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={5}
          placeholder={"best plumber Austin,local,80\nplumber cost Austin,pricing,70"}
          className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm font-mono"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={importCsv}
            disabled={loading || !csv.trim()}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {loading ? "Importing..." : "Import CSV"}
          </button>
          {hasGscConnection ? (
            <button
              type="button"
              onClick={importGsc}
              disabled={loading}
              className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              Import top GSC queries
            </button>
          ) : (
            <a
              href={`/api/oauth?provider=google_search_console&projectId=${projectId}`}
              className="border border-border px-4 py-2 rounded-lg text-sm hover:bg-secondary"
            >
              Connect GSC to import queries
            </a>
          )}
        </div>
        {message && (
          <p className={`text-sm ${message.includes("Imported") ? "text-green-400" : "text-red-400"}`}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
