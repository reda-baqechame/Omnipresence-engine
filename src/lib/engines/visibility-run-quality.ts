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

/** Every completed scan must be 100% measured — zero unavailable, zero model_knowledge. */
const MIN_MEASURED_RATE = 1.0;

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

  const fullyMeasured =
    attempted > 0 &&
    measuredRate >= MIN_MEASURED_RATE &&
    unavailable === 0 &&
    modelKnowledge === 0;

  if (fullyMeasured) {
    status = "completed";
  } else if (measured > 0) {
    status = "partial";
    message = `Incomplete measurement: ${measured}/${attempted} grounded (${Math.round(measuredRate * 100)}%), ${unavailable} unavailable, ${modelKnowledge} model_knowledge. Re-scan after fixing providers.`;
  } else {
    message = "No live visibility measurements — check API keys (SERP + LLM + capture) and re-scan.";
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
