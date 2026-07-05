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

export interface AiUiCaptureSuccess {
  brandMentioned: boolean;
  brandCited: boolean;
  competitorMentions: Record<string, boolean>;
  sourceDomains: string[];
  citedUrls: string[];
  answer: string;
  /** First-class evidence from the capture service (for ai_capture_evidence). */
  responseHash?: string;
  screenshotBase64?: string | null;
  domHtml?: string | null;
  /** Effective geo/locale/persona the capture ran under (provenance). */
  captureContext?: { geo?: string; locale?: string; timezone?: string; persona?: string };
  evidenceUrl?: string | null;
  /** False when SERP loaded but the AI block was absent (still measured). */
  surfacePresent?: boolean;
  absence?: boolean;
}

export interface AiUiCaptureBlocked {
  blocked: true;
  reason: string;
}

export type AiUiCaptureResult = AiUiCaptureSuccess | AiUiCaptureBlocked;

export function isCaptureBlocked(r: AiUiCaptureResult | null): r is AiUiCaptureBlocked {
  return Boolean(r && "blocked" in r && r.blocked === true);
}

/** Geo/persona/locale controls for a capture (all optional). */
export interface AiUiCaptureOptions {
  geo?: string;
  locale?: string;
  timezone?: string;
  persona?: "desktop" | "mobile";
  /** Request heavy evidence artifacts (screenshot + DOM). Default true. */
  withEvidence?: boolean;
}

/**
 * Capture a grounded AI answer from the configured UI-capture backend. Returns
 * null when disabled or on transport failure — callers must fall back honestly.
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
  competitors: string[],
  options: AiUiCaptureOptions = {}
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
      body: JSON.stringify({
        surface,
        prompt,
        brandName,
        brandDomain,
        competitors,
        geo: options.geo,
        locale: options.locale,
        timezone: options.timezone,
        persona: options.persona,
        withEvidence: options.withEvidence,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (res.status === 409) {
      const data = (await res.json().catch(() => ({}))) as { reason?: string };
      return { blocked: true, reason: data.reason || "capture_blocked" };
    }
    // 204 = page did not load / login required — not a measured absence.
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<AiUiCaptureSuccess> & { answer?: string };
    if (!data) return null;
    const isAbsence = data.surfacePresent === false || data.absence === true;
    if (!isAbsence && typeof data.answer !== "string") return null;
    return {
      brandMentioned: Boolean(data.brandMentioned),
      brandCited: Boolean(data.brandCited),
      competitorMentions: data.competitorMentions || {},
      sourceDomains: data.sourceDomains || [],
      citedUrls: data.citedUrls || [],
      answer: data.answer || "",
      responseHash: data.responseHash,
      screenshotBase64: data.screenshotBase64 ?? null,
      domHtml: data.domHtml ?? null,
      captureContext: data.captureContext,
      evidenceUrl: data.evidenceUrl ?? null,
      surfacePresent: data.surfacePresent !== false,
      absence: isAbsence,
    };
  } catch {
    return null;
  }
}
