import type { VisibilityEngine } from "@/types/database";

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
