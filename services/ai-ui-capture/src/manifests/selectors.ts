import type { Surface } from "../capture.js";

export const MANIFEST_VERSION = "v2026-07-01" as const;

/** Versioned selector manifest — update MANIFEST_VERSION when selectors change. */
export const SURFACE_SELECTORS: Record<Surface, readonly string[]> = {
  google_ai_overview: [
    "[data-attrid='AIOverview']",
    "div[jsname][data-mcpr]",
    ".WaaZC",
    "[data-subtree='aimc']",
    ".LLtSOc",
    "div[data-snhf='0']",
  ],
  bing_copilot: [
    "[class*='b_ans']",
    "#copans",
    "[data-priority='2']",
    ".b_slidebar",
    "div.b_algoSlug",
  ],
  perplexity: ["main"],
  chatgpt: ["textarea", "div[contenteditable='true']", "main"],
  gemini: ["textarea", "div[contenteditable='true']", "main"],
};
