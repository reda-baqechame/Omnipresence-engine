import { labsApiPost } from "@/lib/providers/dataforseo";

/**
 * Embeddings provider (Phase 3). Delegates to the always-on OmniData service,
 * which runs all-MiniLM-L6-v2 locally (keyless). Returns `available:false` when
 * OmniData isn't configured or the model isn't loaded — never fabricated zeros.
 */

const USE_OMNIDATA = Boolean(process.env.OMNIDATA_BASE_URL?.replace(/\/$/, ""));

export interface EmbeddingsResponse {
  available: boolean;
  model?: string;
  dims?: number;
  embeddings: number[][];
  reason?: string;
}

export function hasEmbeddingsCapability(): boolean {
  return USE_OMNIDATA;
}

export async function embedTexts(texts: string[]): Promise<EmbeddingsResponse> {
  const clean = texts.map((t) => (t || "").trim()).filter(Boolean);
  if (!clean.length) return { available: false, embeddings: [], reason: "No input text" };
  if (!USE_OMNIDATA) {
    return { available: false, embeddings: [], reason: "OmniData (embeddings) not configured" };
  }

  try {
    const data = await labsApiPost<{
      tasks: Array<{ result: Array<{ available?: boolean; model?: string; dims?: number; embeddings?: number[][]; reason?: string }> }>;
    }>("/embeddings/batch", [{ texts: clean.slice(0, 64) }]);

    const block = data?.tasks?.[0]?.result?.[0];
    if (!block || !block.available || !block.embeddings?.length) {
      return { available: false, embeddings: [], reason: block?.reason || "Embeddings unavailable" };
    }
    return {
      available: true,
      model: block.model,
      dims: block.dims,
      embeddings: block.embeddings,
    };
  } catch (err) {
    return {
      available: false,
      embeddings: [],
      reason: err instanceof Error ? err.message : "Embeddings request failed",
    };
  }
}
