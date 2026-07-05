import type { VisibilityResult } from "@/types/database";
import { resultDataQuality } from "@/lib/engines/provenance";

export interface PromptTripleMetric {
  prompt: string;
  engine: string;
  /** Mention rate for this prompt+engine cell (0 or 1 for single probe, or aggregated). */
  visibility: number;
  /** Ordinal position in answer (lower = better). Null if not mentioned. */
  position: number | null;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  grounded: boolean;
  dataSource: string;
}

function sentimentLabel(s: string | undefined): PromptTripleMetric["sentiment"] {
  if (s === "positive" || s === "neutral" || s === "negative") return s;
  return "unknown";
}

/** Peec-style Visibility / Position / Sentiment per prompt+engine from stored probes. */
export function buildPromptTripleMetrics(results: VisibilityResult[]): PromptTripleMetric[] {
  const map = new Map<string, {
    prompt: string;
    engine: string;
    mentioned: number;
    total: number;
    positions: number[];
    sentiments: string[];
    grounded: boolean;
    dataSource: string;
  }>();

  for (const r of results) {
    const q = resultDataQuality(r);
    if (q === "unavailable" || q === "simulated") continue;
    const key = `${r.engine}::${r.prompt_text}`;
    let cell = map.get(key);
    if (!cell) {
      cell = {
        prompt: r.prompt_text,
        engine: r.engine,
        mentioned: 0,
        total: 0,
        positions: [],
        sentiments: [],
        grounded: false,
        dataSource: q,
      };
      map.set(key, cell);
    }
    cell.total += 1;
    if (r.brand_mentioned) cell.mentioned += 1;
    if (typeof r.answer_position === "number" && r.answer_position > 0) {
      cell.positions.push(r.answer_position);
    }
    if (r.sentiment) cell.sentiments.push(r.sentiment);
    if (q === "measured") cell.grounded = true;
  }

  return [...map.values()].map((c) => ({
    prompt: c.prompt,
    engine: c.engine,
    visibility: c.total > 0 ? c.mentioned / c.total : 0,
    position: c.positions.length
      ? Math.round((c.positions.reduce((a, b) => a + b, 0) / c.positions.length) * 10) / 10
      : null,
    sentiment: sentimentLabel(c.sentiments[c.sentiments.length - 1]),
    grounded: c.grounded,
    dataSource: c.dataSource,
  }));
}
