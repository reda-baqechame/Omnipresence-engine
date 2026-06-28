/**
 * Topic clustering over local embeddings (keyless).
 *
 * Implements the BERTopic *technique* in-process (no Python sidecar): embed →
 * density/agglomerative cluster on cosine distance → label clusters with a
 * c-TF-IDF top-term extraction. This replaces order-dependent greedy clustering
 * with deterministic average-linkage agglomerative merging, giving much sharper
 * intent groups for keyword universes, content gaps, and cannibalization.
 *
 * A heavier Python BERTopic+UMAP+HDBSCAN service can be swapped in later behind
 * the same endpoint; this delivers the capability today with zero extra infra.
 */
import { embedTexts } from "./embeddings.js";

export interface TopicCluster {
  label: string;
  terms: string[];
  members: string[];
}

export interface ClusteringResult {
  available: boolean;
  model?: string;
  clusters: TopicCluster[];
  data_source: "measured" | "unavailable";
  reason?: string;
}

function cosine(a: number[], b: number[]): number {
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

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "is",
  "are", "how", "what", "best", "vs", "your", "you", "we", "our", "by", "at",
  "from", "this", "that", "it", "as", "be", "can", "do", "does", "near", "me",
]);

/** c-TF-IDF-style label: the most distinctive terms within a cluster. */
export function labelCluster(members: string[], allDocs: string[]): { label: string; terms: string[] } {
  const tokenize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));

  const clusterTf = new Map<string, number>();
  for (const m of members) for (const t of tokenize(m)) clusterTf.set(t, (clusterTf.get(t) || 0) + 1);

  const docFreq = new Map<string, number>();
  for (const d of allDocs) {
    for (const t of new Set(tokenize(d))) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }

  const n = allDocs.length;
  const scored = [...clusterTf.entries()]
    .map(([term, tf]) => ({ term, score: tf * Math.log((n + 1) / ((docFreq.get(term) || 0) + 1)) }))
    .sort((a, b) => b.score - a.score);

  const terms = scored.slice(0, 4).map((s) => s.term);
  // Prefer a real member phrase containing the top term as the human label.
  const top = terms[0];
  const label =
    (top && members.find((m) => m.toLowerCase().includes(top))) || members[0] || (terms.join(" ") || "cluster");
  return { label, terms };
}

/** Average-linkage agglomerative clustering on cosine similarity. */
export function agglomerate(vectors: number[][], threshold: number): number[][] {
  let clusters: number[][] = vectors.map((_, i) => [i]);

  const clusterSim = (c1: number[], c2: number[]): number => {
    let sum = 0;
    for (const i of c1) for (const j of c2) sum += cosine(vectors[i], vectors[j]);
    return sum / (c1.length * c2.length);
  };

  let merged = true;
  while (merged && clusters.length > 1) {
    merged = false;
    let bestI = -1;
    let bestJ = -1;
    let bestSim = threshold;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const sim = clusterSim(clusters[i], clusters[j]);
        if (sim >= bestSim) {
          bestSim = sim;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (bestI >= 0) {
      clusters[bestI] = clusters[bestI].concat(clusters[bestJ]);
      clusters = clusters.filter((_, idx) => idx !== bestJ);
      merged = true;
    }
  }
  return clusters;
}

export async function clusterTexts(texts: string[], threshold = 0.62): Promise<ClusteringResult> {
  const uniq = [...new Set(texts.map((t) => (t || "").trim()).filter(Boolean))].slice(0, 400);
  if (uniq.length < 2) {
    return {
      available: true,
      clusters: uniq.map((m) => ({ label: m, terms: [], members: [m] })),
      data_source: "measured",
    };
  }

  const emb = await embedTexts(uniq);
  if (!emb.available || emb.embeddings.length !== uniq.length) {
    return { available: false, clusters: [], data_source: "unavailable", reason: emb.reason || "embeddings unavailable" };
  }

  const groups = agglomerate(emb.embeddings, threshold);
  const clusters: TopicCluster[] = groups
    .map((g) => {
      const members = g.map((i) => uniq[i]);
      const { label, terms } = labelCluster(members, uniq);
      return { label, terms, members };
    })
    .sort((a, b) => b.members.length - a.members.length);

  return { available: true, model: emb.model, clusters, data_source: "measured" };
}
