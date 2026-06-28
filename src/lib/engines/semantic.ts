import { embedTexts, hasEmbeddingsCapability, clusterTopicsRemote } from "@/lib/providers/embeddings";

/**
 * Semantic engine (Phase 3). Thin, reusable layer over the keyless embeddings
 * provider: cosine similarity, nearest-neighbor relevance, topic clustering,
 * and keyword cannibalization detection. All degrade gracefully to
 * `available:false` when embeddings aren't configured.
 */

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export { hasEmbeddingsCapability };

export interface CannibalizationPair {
  a: string;
  b: string;
  similarity: number;
}

/**
 * Detect cannibalization: pairs of pages/titles whose topics are so similar they
 * compete for the same intent. `items` are { ref, text } where ref is a URL/id.
 */
export async function detectCannibalization(
  items: { ref: string; text: string }[],
  threshold = 0.86
): Promise<{ available: boolean; reason?: string; pairs: CannibalizationPair[] }> {
  if (!hasEmbeddingsCapability()) {
    return { available: false, reason: "Embeddings not configured (set OMNIDATA_BASE_URL).", pairs: [] };
  }
  const valid = items.filter((i) => i.text?.trim());
  if (valid.length < 2) return { available: true, pairs: [] };

  const res = await embedTexts(valid.map((i) => i.text));
  if (!res.available || res.embeddings.length !== valid.length) {
    return { available: false, reason: res.reason || "Embeddings unavailable", pairs: [] };
  }

  const pairs: CannibalizationPair[] = [];
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const sim = cosineSimilarity(res.embeddings[i], res.embeddings[j]);
      if (sim >= threshold) {
        pairs.push({ a: valid[i].ref, b: valid[j].ref, similarity: Math.round(sim * 1000) / 1000 });
      }
    }
  }
  return { available: true, pairs: pairs.sort((x, y) => y.similarity - x.similarity) };
}

export interface SemanticCluster {
  label: string;
  members: string[];
  /** Distinctive c-TF-IDF terms for the cluster (when computed server-side). */
  terms?: string[];
}

/**
 * Semantic clustering of short texts (keywords/titles) into topic groups.
 *
 * Prefers the OmniData clustering endpoint (agglomerative average-linkage +
 * c-TF-IDF labels — the BERTopic technique, scales to ~400 items). Falls back to
 * the in-app greedy clustering when the endpoint is unavailable.
 */
export async function clusterTexts(
  items: string[],
  threshold = 0.72
): Promise<{ available: boolean; reason?: string; clusters: SemanticCluster[] }> {
  if (!hasEmbeddingsCapability()) {
    return { available: false, reason: "Embeddings not configured.", clusters: [] };
  }

  // Preferred: server-side topic clustering (sharper, order-independent, labeled).
  const remote = await clusterTopicsRemote(items);
  if (remote.available && remote.clusters.length) {
    return {
      available: true,
      clusters: remote.clusters.map((c) => ({ label: c.label, members: c.members, terms: c.terms })),
    };
  }

  const uniq = [...new Set(items.map((i) => i.trim()).filter(Boolean))].slice(0, 64);
  if (uniq.length < 2) return { available: true, clusters: uniq.map((m) => ({ label: m, members: [m] })) };

  const res = await embedTexts(uniq);
  if (!res.available || res.embeddings.length !== uniq.length) {
    return { available: false, reason: res.reason || "Embeddings unavailable", clusters: [] };
  }

  const assigned = new Array<boolean>(uniq.length).fill(false);
  const clusters: SemanticCluster[] = [];
  for (let i = 0; i < uniq.length; i++) {
    if (assigned[i]) continue;
    assigned[i] = true;
    const members = [uniq[i]];
    for (let j = i + 1; j < uniq.length; j++) {
      if (assigned[j]) continue;
      if (cosineSimilarity(res.embeddings[i], res.embeddings[j]) >= threshold) {
        assigned[j] = true;
        members.push(uniq[j]);
      }
    }
    clusters.push({ label: uniq[i], members });
  }
  return { available: true, clusters: clusters.sort((a, b) => b.members.length - a.members.length) };
}

/**
 * Rank candidate targets by semantic relevance to a source text. Used to boost
 * internal-linking suggestions beyond lexical overlap.
 */
export async function rankBySemanticRelevance(
  sourceText: string,
  candidates: { ref: string; text: string }[]
): Promise<{ available: boolean; reason?: string; ranked: { ref: string; similarity: number }[] }> {
  if (!hasEmbeddingsCapability()) {
    return { available: false, reason: "Embeddings not configured.", ranked: [] };
  }
  const valid = candidates.filter((c) => c.text?.trim());
  if (!sourceText.trim() || valid.length === 0) {
    return { available: true, ranked: [] };
  }
  const res = await embedTexts([sourceText, ...valid.map((c) => c.text)]);
  if (!res.available || res.embeddings.length !== valid.length + 1) {
    return { available: false, reason: res.reason || "Embeddings unavailable", ranked: [] };
  }
  const [src, ...rest] = res.embeddings;
  const ranked = valid
    .map((c, i) => ({ ref: c.ref, similarity: Math.round(cosineSimilarity(src, rest[i]) * 1000) / 1000 }))
    .sort((a, b) => b.similarity - a.similarity);
  return { available: true, ranked };
}
