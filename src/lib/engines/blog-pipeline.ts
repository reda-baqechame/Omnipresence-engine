/** 14-step blog pipeline (AEO Engine pattern) for content domination. */
import { fetchWithTimeout } from "@/lib/providers/http";

// Step metadata + pure progress helpers live in blog-pipeline-steps.ts (no
// heavy imports) so client components can depend on just that file instead
// of pulling in this one's network-calling exports below. Re-exported here
// for backward compatibility with existing server-side importers.
export {
  BLOG_PIPELINE_STEPS,
  type BlogPipelineStepKey,
  getPipelineProgress,
  advancePipeline,
} from "./blog-pipeline-steps";

/**
 * Generate a real featured/hero image via the OpenAI Images API (gpt-image-1).
 * Returns base64 PNG the caller can upload to storage. Requires OPENAI_API_KEY.
 */
export async function generateFeaturedImage(
  prompt: string,
  opts: { size?: "1024x1024" | "1536x1024" | "1024x1536"; style?: string } = {}
): Promise<{ success: boolean; b64?: string; error?: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { success: false, error: "OPENAI_API_KEY not configured" };
  try {
    const fullPrompt = opts.style
      ? `${prompt}. Style: ${opts.style}. Clean, professional, editorial blog hero image, no text overlay.`
      : `${prompt}. Clean, professional, editorial blog hero image, no text overlay.`;
    const res = await fetchWithTimeout("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: fullPrompt,
        size: opts.size || "1536x1024",
        n: 1,
      }),
      timeoutMs: 90000, // image generation is slow; don't cut off a legit render
    });
    if (!res.ok) {
      return { success: false, error: `Image API error: ${res.status}` };
    }
    const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return { success: false, error: "No image returned" };
    return { success: true, b64 };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Image generation failed" };
  }
}

/** Common AEO target locales (BCP-47 + English label). */
export const SUPPORTED_LOCALES: Array<{ code: string; label: string }> = [
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese (Simplified)" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
];

/**
 * Translate content into a target locale while preserving Markdown/HTML
 * structure and answer-first passages (so AEO formatting survives).
 */
export async function translateContent(
  content: string,
  targetLocale: string
): Promise<{ success: boolean; content?: string; error?: string }> {
  const locale = SUPPORTED_LOCALES.find((l) => l.code === targetLocale);
  const label = locale?.label || targetLocale;
  const { generateWithAI } = await import("@/lib/providers/ai-gateway");
  const result = await generateWithAI(
    `You are a professional localizer. Translate content into ${label} for native readers. Preserve all Markdown/HTML structure, headings, lists, links, and code. Keep brand names, URLs, and code untranslated. Maintain the answer-first passage structure (question heading + concise answer + detail).`,
    content,
    "quality"
  );
  if (!result.success || !result.data) {
    return { success: false, error: result.error || "Translation failed" };
  }
  return { success: true, content: result.data };
}

/** Produce localized variants of a piece of content for multiple target locales. */
export async function generateMultiLanguageVersions(
  content: string,
  targetLocales: string[]
): Promise<Array<{ locale: string; content: string }>> {
  const results = await Promise.all(
    targetLocales.map(async (locale) => {
      const r = await translateContent(content, locale);
      return r.success && r.content ? { locale, content: r.content } : null;
    })
  );
  return results.filter((r): r is { locale: string; content: string } => r !== null);
}
