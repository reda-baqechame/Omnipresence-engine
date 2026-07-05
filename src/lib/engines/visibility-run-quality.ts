import type { VisibilityScanResult } from "@/lib/engines/visibility-scanner";
import { getActiveScanEngines } from "@/lib/config/scan-engines";
import type { VisibilityEngine } from "@/types/database";

const LLM_ENGINES = new Set<VisibilityEngine>(["chatgpt", "claude", "gemini", "perplexity"]);

export interface VisibilityRunQuality {
  attempted: number;
  measured: number;
  modelKnowledge: number;
  unavailable: number;
  measuredRate: number;
  llmEnginesWithSignal: number;
  acceptable: boolean;
  status: "completed" | "partial" | "failed";
  message: string | null;
}

/** Minimum grounded measurements before we call a scan professionally usable. */
const MIN_GROUNDED_PROBES = 12;
const MIN_MEASURED_RATE = 0.15;
const MIN_LLM_ENGINES = 2;

export function assessVisibilityRunQuality(results: VisibilityScanResult[]): VisibilityRunQuality {
  const attempted = results.length;
  const measured = results.filter((r) => r.data_source === "measured").length;
  const modelKnowledge = results.filter((r) => r.data_source === "model_knowledge").length;
  const unavailable = results.filter((r) => r.data_source === "unavailable").length;
  const measuredRate = attempted > 0 ? measured / attempted : 0;

  const llmEnginesWithSignal = getActiveScanEngines().filter((engine) => {
    if (!LLM_ENGINES.has(engine)) return false;
    return results.some(
      (r) =>
        r.engine === engine &&
        (r.data_source === "measured" || r.data_source === "model_knowledge")
    );
  }).length;

  let status: VisibilityRunQuality["status"] = "failed";
  let message: string | null = null;

  if (measured >= MIN_GROUNDED_PROBES && measuredRate >= MIN_MEASURED_RATE && llmEnginesWithSignal >= MIN_LLM_ENGINES) {
    status = "completed";
  } else if (measured > 0 || modelKnowledge > 0) {
    status = "partial";
    message = `Only ${measured} grounded probes (${Math.round(measuredRate * 100)}% coverage, ${llmEnginesWithSignal} AI engines responding). Connect SERP + LLM keys and re-scan for full measurement.`;
  } else {
    message = "No live visibility measurements — check API keys (SERP + LLM) and re-scan.";
  }

  const acceptable = status === "completed";

  return {
    attempted,
    measured,
    modelKnowledge,
    unavailable,
    measuredRate,
    llmEnginesWithSignal,
    acceptable,
    status,
    message,
  };
}

export function visibilityRunStatusFromQuality(quality: VisibilityRunQuality): "completed" | "failed" {
  return quality.status === "completed" ? "completed" : "failed";
}
