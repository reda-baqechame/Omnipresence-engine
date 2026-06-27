import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";

/**
 * Ollama — self-hosted open-model runtime (Phase 8). Runs Llama 3 / Mistral /
 * Qwen etc. locally or on a Railway service for a *free* AI-visibility probe
 * alongside the paid ChatGPT/Claude/Gemini path. Always `model_knowledge`
 * (parametric, no browsing). Degrades to `available:false` when not configured.
 */

export function hasOllamaCapability(): boolean {
  const u = process.env.OLLAMA_BASE_URL;
  return Boolean(u && u.trim() && !u.startsWith("your-"));
}

function getOllamaUrl(): string {
  return (process.env.OLLAMA_BASE_URL || "").replace(/\/+$/, "");
}

export function getOllamaModel(): string {
  return process.env.OLLAMA_MODEL || "llama3.1";
}

interface OllamaChatResponse {
  message?: { content?: string };
  response?: string;
}

export async function generateWithOllama(
  systemPrompt: string,
  userPrompt: string
): Promise<{ available: boolean; reason?: string; text: string }> {
  if (!hasOllamaCapability()) {
    return { available: false, reason: "OLLAMA_BASE_URL not configured", text: "" };
  }
  const base = getOllamaUrl();
  try {
    const res = await fetchWithTimeout(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getOllamaModel(),
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      timeoutMs: 60_000,
    });
    if (!res.ok) return { available: false, reason: `Ollama ${res.status}`, text: "" };
    const data = (await res.json()) as OllamaChatResponse;
    const text = data.message?.content || data.response || "";
    return { available: true, text };
  } catch (error) {
    logProviderError("ollama", error, { model: getOllamaModel() });
    return { available: false, reason: error instanceof Error ? error.message : "Ollama failed", text: "" };
  }
}
