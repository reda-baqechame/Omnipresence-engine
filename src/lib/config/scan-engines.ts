import type { VisibilityEngine } from "@/types/database";

/** Canonical engines used across scan-runner, Inngest steps, and visibility scanner. */
export const SCAN_ENGINES: VisibilityEngine[] = [
  "chatgpt",
  "perplexity",
  "gemini",
  "claude",
  "google_organic",
  "google_ai_overview",
];
