import type { VisibilityEngine } from "@/types/database";
import { hasGoogleSerpCapability } from "@/lib/config/capabilities";

/**
 * Canonical engines used across scan-runner, Inngest steps, and visibility
 * scanner. Every engine the OmniPresence score weights (incl. bing_copilot) is
 * listed here so it is ACTUALLY probed — measured when a backend exists, or
 * honestly labelled `unavailable` otherwise. No engine is scored-but-unprobed.
 */
export const SCAN_ENGINES: VisibilityEngine[] = [
  "chatgpt",
  "perplexity",
  "gemini",
  "claude",
  "bing_copilot",
  "google_organic",
  "google_ai_overview",
];

function hasEnv(name: string): boolean {
  const v = process.env[name];
  return Boolean(v && v.length > 0 && !v.startsWith("your-"));
}

/** Engines we can actually measure in this deployment (keys + backends present). */
export function getActiveScanEngines(): VisibilityEngine[] {
  const engines: VisibilityEngine[] = [];
  const captureOn = process.env.ENABLE_AI_UI_CAPTURE === "true" && hasEnv("AI_UI_CAPTURE_URL");
  if (hasEnv("OPENAI_API_KEY")) engines.push("chatgpt");
  if (hasEnv("PERPLEXITY_API_KEY") || captureOn) engines.push("perplexity");
  if (hasEnv("GOOGLE_GENERATIVE_AI_API_KEY")) engines.push("gemini");
  if (hasEnv("ANTHROPIC_API_KEY")) engines.push("claude");
  if (captureOn) engines.push("bing_copilot");
  // Surface identity: Google engines require a provider that ACTUALLY queries
  // Google (Serper/OmniData/DataForSEO/Firecrawl). A keyless DuckDuckGo SERP
  // must never make "google_organic" look configured.
  if (hasGoogleSerpCapability()) engines.push("google_organic", "google_ai_overview");
  return engines.length ? engines : ["google_organic"];
}

/** Whether a single engine has the provider credentials/backends it needs. */
export function isEngineConfigured(engine: VisibilityEngine): boolean {
  const captureOn = process.env.ENABLE_AI_UI_CAPTURE === "true" && hasEnv("AI_UI_CAPTURE_URL");
  switch (engine) {
    case "chatgpt":
      return hasEnv("OPENAI_API_KEY");
    case "claude":
      return hasEnv("ANTHROPIC_API_KEY");
    case "gemini":
      return hasEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    case "perplexity":
      return hasEnv("PERPLEXITY_API_KEY") || captureOn;
    case "bing_copilot":
      return captureOn;
    case "google_organic":
    case "google_ai_overview":
      return hasGoogleSerpCapability();
    default:
      return false;
  }
}
