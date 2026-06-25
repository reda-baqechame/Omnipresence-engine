"use client";

import { useEffect, useState } from "react";

interface IntelligencePanelProps {
  projectId: string;
}

export function IntelligencePanel({ projectId }: IntelligencePanelProps) {
  const [data, setData] = useState<{
    aeo?: {
      shareOfVoice: number;
      citationRate: number;
      mentionRate: number;
      recommendationRate: number;
      measuredRate: number;
      competitorShare: Record<string, number>;
      engineBreakdown: Record<string, { mentions: number; citations: number; prompts: number }>;
    };
    runComparison?: {
      delta: { shareOfVoice: number; citationRate: number; mentionRate: number };
    };
    dataQuality?: { live: boolean; measuredRate: number };
  } | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/intelligence?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        if (active) setData(d);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  if (!data?.aeo) {
    return (
      <p className="text-sm text-muted-foreground">
        Run a visibility scan to populate AEO metrics (share of voice, citation rate, engine breakdown).
      </p>
    );
  }

  const aeo = data.aeo;
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-4 gap-4">
        {[
          { label: "Share of voice", value: pct(aeo.shareOfVoice) },
          { label: "Citation rate", value: pct(aeo.citationRate) },
          { label: "Mention rate", value: pct(aeo.mentionRate) },
          { label: "AI recommendation rate", value: pct(aeo.recommendationRate) },
        ].map((m) => (
          <div key={m.label} className="bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-primary">{m.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{m.label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span
          className={`px-2 py-1 rounded-full text-xs ${
            data.dataQuality?.live
              ? "bg-green-500/10 text-green-400 border border-green-500/30"
              : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30"
          }`}
        >
          {data.dataQuality?.live ? "Measured AEO data" : "Limited measurement"}
        </span>
        <span className="text-muted-foreground">
          {Math.round((aeo.measuredRate || 0) * 100)}% probes from live engines
        </span>
      </div>

      {data.runComparison && (
        <div className="bg-card border border-border rounded-xl p-4 text-sm">
          <h4 className="font-semibold mb-2">Run-over-run delta</h4>
          <p>
            Share of voice: {data.runComparison.delta.shareOfVoice >= 0 ? "+" : ""}
            {pct(data.runComparison.delta.shareOfVoice)}
            {" · "}
            Citations: {data.runComparison.delta.citationRate >= 0 ? "+" : ""}
            {pct(data.runComparison.delta.citationRate)}
          </p>
        </div>
      )}

      {Object.keys(aeo.competitorShare || {}).length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h4 className="font-semibold mb-3">Competitor mention share</h4>
          <ul className="space-y-1 text-sm">
            {Object.entries(aeo.competitorShare)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 8)
              .map(([comp, count]) => (
                <li key={comp} className="flex justify-between">
                  <span>{comp}</span>
                  <span className="text-muted-foreground">{count} mentions</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-4">
        <h4 className="font-semibold mb-3">AEO by engine</h4>
        <div className="grid md:grid-cols-2 gap-2 text-sm">
          {Object.entries(aeo.engineBreakdown || {}).map(([engine, stats]) => (
            <div key={engine} className="bg-secondary/30 rounded-lg p-3">
              <div className="font-medium capitalize">{engine.replace(/_/g, " ")}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {stats.mentions}/{stats.prompts} mentions · {stats.citations} citations
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
