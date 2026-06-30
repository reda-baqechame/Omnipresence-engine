/**
 * Optional AI UI-surface capture (Profound-style).
 *
 * LLM API answers reflect the model's parametric knowledge ("model_knowledge").
 * The real surface a user sees is the live product UI (ChatGPT with browsing,
 * Google AI Overviews, Perplexity), which performs retrieval. Capturing that UI
 * is the only way to measure GROUNDED visibility for API-less engines.
 *
 * Real UI capture requires a browser-automation backend (and must respect each
 * platform's ToS). Rather than ship a brittle in-process scraper, this module
 * delegates to a configurable capture endpoint when explicitly enabled, and is
 * otherwise inert (returns null) so nothing is ever fabricated.
 *
 * Enable with:
 *   ENABLE_AI_UI_CAPTURE=true
 *   AI_UI_CAPTURE_URL=https://your-capture-service/endpoint
 *   AI_UI_CAPTURE_KEY=...            (optional bearer)
 */

export function hasAiUiCapture(): boolean {
  return (
    process.env.ENABLE_AI_UI_CAPTURE === "true" &&
    Boolean(process.env.AI_UI_CAPTURE_URL && process.env.AI_UI_CAPTURE_URL.length > 0)
  );
}

export interface AiUiCaptureResult {
  brandMentioned: boolean;
  brandCited: boolean;
  competitorMentions: Record<string, boolean>;
  sourceDomains: string[];
  citedUrls: string[];
  answer: string;
}

/**
 * Capture a grounded AI answer from the configured UI-capture backend. Returns
 * null when disabled or on any failure — callers must fall back to the API path
 * and label the result honestly.
 */
export type AiUiCaptureSurface =
  | "chatgpt"
  | "gemini"
  | "perplexity"
  | "google_ai_overview"
  | "bing_copilot";

export async function captureAiUiSurface(
  surface: AiUiCaptureSurface,
  prompt: string,
  brandName: string,
  brandDomain: string,
  competitors: string[]
): Promise<AiUiCaptureResult | null> {
  if (!hasAiUiCapture()) return null;
  const url = process.env.AI_UI_CAPTURE_URL as string;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.AI_UI_CAPTURE_KEY ? { Authorization: `Bearer ${process.env.AI_UI_CAPTURE_KEY}` } : {}),
      },
      body: JSON.stringify({ surface, prompt, brandName, brandDomain, competitors }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<AiUiCaptureResult> & { answer?: string };
    if (!data || typeof data.answer !== "string") return null;
    return {
      brandMentioned: Boolean(data.brandMentioned),
      brandCited: Boolean(data.brandCited),
      competitorMentions: data.competitorMentions || {},
      sourceDomains: data.sourceDomains || [],
      citedUrls: data.citedUrls || [],
      answer: data.answer,
    };
  } catch {
    return null;
  }
}
