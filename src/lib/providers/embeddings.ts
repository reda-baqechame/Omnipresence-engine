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

export interface RemoteTopicCluster {
  label: string;
  terms: string[];
  members: string[];
}

export interface ClusteringResponse {
  available: boolean;
  model?: string;
  clusters: RemoteTopicCluster[];
  reason?: string;
}

/**
 * Server-side topic clustering via OmniData (agglomerative + c-TF-IDF labels).
 * Scales beyond the in-app greedy clustering and centralizes embeddings.
 */
export async function clusterTopicsRemote(
  texts: string[],
  threshold?: number
): Promise<ClusteringResponse> {
  const clean = texts.map((t) => (t || "").trim()).filter(Boolean);
  if (!clean.length) return { available: false, clusters: [], reason: "No input text" };
  if (!USE_OMNIDATA) return { available: false, clusters: [], reason: "OmniData not configured" };

  try {
    const data = await labsApiPost<{
      tasks: Array<{
        result: Array<{ available?: boolean; model?: string; clusters?: RemoteTopicCluster[]; reason?: string }>;
      }>;
    }>("/clustering/topics/live", [{ texts: clean.slice(0, 400), threshold }]);

    const block = data?.tasks?.[0]?.result?.[0];
    if (!block || !block.available || !block.clusters) {
      return { available: false, clusters: [], reason: block?.reason || "Clustering unavailable" };
    }
    return { available: true, model: block.model, clusters: block.clusters };
  } catch (err) {
    return {
      available: false,
      clusters: [],
      reason: err instanceof Error ? err.message : "Clustering request failed",
    };
  }
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
