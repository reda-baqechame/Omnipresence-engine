"use client";

import type { ReactNode } from "react";

/** Competitor-parity metric labels (Otterly / Peec / Profound / Semrush vocabulary). */
export const METRIC_GLOSSARY: Record<
  string,
  { label: string; short: string; competitor: string }
> = {
  share_of_ai_voice: {
    label: "Share of AI Voice",
    short: "Prominence-weighted share of measured AI answers citing or naming your brand.",
    competitor: "Otterly headline KPI",
  },
  visibility: {
    label: "Visibility",
    short: "Mention rate — how often your brand appears in AI answers for this prompt.",
    competitor: "Peec Visibility",
  },
  position: {
    label: "Position",
    short: "Where in the answer your brand appears (lower = earlier / stronger).",
    competitor: "Peec Position",
  },
  sentiment: {
    label: "Sentiment",
    short: "Tone of the mention when your brand appears (positive / neutral / negative).",
    competitor: "Peec Sentiment",
  },
  prompt_demand: {
    label: "Prompt demand",
    short: "Relative query interest from Autocomplete breadth + Trends momentum — not Google Ads volume.",
    competitor: "Profound prompt volume",
  },
  volume_confidence: {
    label: "Volume confidence",
    short: "high = Keyword Planner or GSC anchor; medium = Trends extrapolation; low = heuristic bucket.",
    competitor: "Semrush volume tier",
  },
  difficulty_real: {
    label: "Keyword difficulty",
    short: "Real KD from authority of domains currently ranking (Tranco / CC WebGraph).",
    competitor: "Ahrefs KD",
  },
  popularity_index: {
    label: "Popularity index",
    short: "Relative 0–100 from Tranco, rank.to, and Common Crawl PageRank — not visit counts.",
    competitor: "SimilarWeb relative rank",
  },
  ads_equivalent: {
    label: "Paid search equivalent",
    short: "Organic + AI referral sessions valued at industry or custom CPC — not measured auction spend.",
    competitor: "Semrush traffic value",
  },
};

export function MetricGlossary({
  keys,
  className = "",
}: {
  keys: Array<keyof typeof METRIC_GLOSSARY>;
  className?: string;
}) {
  return (
    <div className={`text-xs text-muted-foreground space-y-1 ${className}`}>
      {keys.map((k) => {
        const m = METRIC_GLOSSARY[k];
        if (!m) return null;
        return (
          <p key={k}>
            <span className="font-medium text-foreground">{m.label}</span> — {m.short}
            <span className="ml-1 opacity-60">({m.competitor})</span>
          </p>
        );
      })}
    </div>
  );
}

export function MetricTooltip({ metricKey, children }: { metricKey: keyof typeof METRIC_GLOSSARY; children: ReactNode }) {
  const m = METRIC_GLOSSARY[metricKey];
  return (
    <span title={m ? `${m.short} (${m.competitor})` : undefined} className="cursor-help border-b border-dotted border-muted-foreground/50">
      {children}
    </span>
  );
}
