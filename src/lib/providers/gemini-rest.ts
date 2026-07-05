import { fetchWithTimeout } from "@/lib/providers/http";

/** Google AI Studio express keys (AQ.*) use X-goog-api-key, not the AI SDK default. */
export function usesGeminiExpressKey(): boolean {
  const k = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || "";
  return k.startsWith("AQ.");
}

export function geminiRestModelId(): string {
  const fromEnv = process.env.AI_GEMINI_MODEL?.trim();
  if (fromEnv) return fromEnv;
  return usesGeminiExpressKey() ? "gemini-flash-latest" : "gemini-2.5-flash";
}

export function geminiRestModelChain(): string[] {
  const primary = geminiRestModelId();
  if (usesGeminiExpressKey()) {
    return [...new Set([primary, "gemini-flash-latest", "gemini-2.0-flash"])];
  }
  return [...new Set([primary, "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"])];
}

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
}

/**
 * Direct REST call to Generative Language API (supports AQ.* express keys).
 */
export async function generateGeminiRest(
  systemPrompt: string,
  userPrompt: string,
  modelId = geminiRestModelId()
): Promise<string> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!key) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY not configured");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key.startsWith("AQ.")) {
    headers["X-goog-api-key"] = key;
  } else {
    // Legacy AIza keys may use query param; express keys must not double-auth.
    headers["X-goog-api-key"] = key;
  }

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    }),
    timeoutMs: 60000,
  });

  const data = (await res.json()) as GenerateContentResponse;
  if (!res.ok) {
    throw new Error(data.error?.message || `Gemini REST HTTP ${res.status}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!text.trim()) throw new Error("Gemini REST returned empty text");
  return text;
}

export async function generateGeminiRestWithFallback(
  systemPrompt: string,
  userPrompt: string
): Promise<{ text: string; modelId: string }> {
  let lastError: unknown;
  for (const modelId of geminiRestModelChain()) {
    try {
      const text = await generateGeminiRest(systemPrompt, userPrompt, modelId);
      return { text, modelId };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not found|not supported|404/i.test(msg)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Gemini REST failed");
}
