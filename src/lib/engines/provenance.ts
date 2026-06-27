/**
 * Data provenance — the trust spine.
 *
 * Every user-facing number must declare HOW it was obtained so the UI can label
 * it honestly and we never present a failed provider as a confident zero. This
 * is the single most important refund-safety primitive in the platform.
 *
 *  - measured        real, live measurement (SERP/API/crawl/LLM-with-retrieval)
 *  - estimated       derived/approximated from open signals (labeled as a range)
 *  - model_knowledge LLM parametric answer, NOT live search UI (Phase 2)
 *  - simulated       demo/sample data (never shown to paid users)
 *  - unavailable     a provider failed or is not configured — NOT a real zero
 */
import type { DataQuality } from "@/types/database";

export type { DataQuality };

export interface Provenance {
  data_source: DataQuality;
  /** 0-1 confidence in the value. */
  confidence?: number;
  last_checked_at?: string;
  evidence_url?: string;
  is_estimated?: boolean;
}

export const PROVENANCE_META: Record<
  DataQuality,
  { label: string; tone: "good" | "warn" | "muted" | "bad"; description: string }
> = {
  measured: {
    label: "Live",
    tone: "good",
    description: "Real, live measurement.",
  },
  estimated: {
    label: "Estimated",
    tone: "warn",
    description: "Approximated from open signals — treat as a range.",
  },
  model_knowledge: {
    label: "Model-knowledge",
    tone: "warn",
    description: "AI model's parametric answer, not live search UI.",
  },
  simulated: {
    label: "Demo",
    tone: "muted",
    description: "Sample data for preview only — not a real measurement.",
  },
  unavailable: {
    label: "Unavailable",
    tone: "bad",
    description: "A data provider failed or is not connected. This is not a zero.",
  },
};

export function provenanceLabel(q: DataQuality | null | undefined): string {
  return PROVENANCE_META[q ?? "unavailable"]?.label ?? "Unavailable";
}

/** True only for genuinely measured live data. */
export function isMeasured(q: DataQuality | null | undefined): boolean {
  return q === "measured";
}

/**
 * Real AI-visibility signal that should count toward a score: a grounded live
 * measurement OR a model-knowledge answer (the model's own recommendation). Both
 * are genuine — demo/estimated/unavailable are not.
 */
export function isCountableVisibility(q: DataQuality | null | undefined): boolean {
  return q === "measured" || q === "model_knowledge";
}

/** A demo/simulated row — must never be mixed into measured metrics or shown to paid users. */
export function isSimulated(q: DataQuality | null | undefined): boolean {
  return q === "simulated";
}

/**
 * Resolve the effective data quality of a visibility result from either the
 * first-class `data_source` column or the legacy `raw_response.data_source`.
 */
export function resultDataQuality(r: {
  data_source?: string | null;
  raw_response?: Record<string, unknown> | null;
}): DataQuality {
  const top = (r.data_source ?? undefined) as DataQuality | undefined;
  if (top) return top;
  const raw = (r.raw_response as { data_source?: string; demo?: boolean } | undefined) || undefined;
  if (raw?.data_source) return raw.data_source as DataQuality;
  if (raw?.demo) return "simulated";
  return "unavailable";
}
