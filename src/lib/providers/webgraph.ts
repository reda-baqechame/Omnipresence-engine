import { omniDataGet, labsApiPost, isOmniDataActive } from "@/lib/providers/dataforseo";

/**
 * Common Crawl webgraph (referring-domain / authority moat) admin + freshness.
 *
 * The heavy ingest runs inside the OmniData service against the DuckDB volume.
 * Here we only read status (for provenance/freshness labels) and trigger a
 * scheduled re-ingest when a crawl release id is configured.
 */

export interface WebgraphStatus {
  available: boolean;
  /** Authority index (Common Crawl harmonic-centrality ranks) is queryable. */
  ready: boolean;
  /** Full backlink edge graph is queryable (needs the 20GB+ volume ingest). */
  edgesReady: boolean;
  ingestInProgress: boolean;
  release: string | null;
  ingestedAt: string | null;
  vertexCount: number;
  edgeCount: number;
}

type DfsEnvelope<T> = { tasks?: Array<{ result?: T[] }> };

function firstResult<T>(env: DfsEnvelope<T> | null): T | null {
  return env?.tasks?.[0]?.result?.[0] ?? null;
}

export async function getWebgraphStatus(): Promise<WebgraphStatus> {
  if (!isOmniDataActive()) {
    return {
      available: false,
      ready: false,
      edgesReady: false,
      ingestInProgress: false,
      release: null,
      ingestedAt: null,
      vertexCount: 0,
      edgeCount: 0,
    };
  }
  const env = await omniDataGet<DfsEnvelope<{
    webgraph_ready?: boolean;
    edges_ready?: boolean;
    ingest_in_progress?: boolean;
    release?: string | null;
    ingested_at?: string | null;
    vertex_count?: number;
    edge_count?: number;
  }>>("/backlinks/webgraph/status");
  const r = firstResult(env);
  const vertexCount = Number(r?.vertex_count ?? 0);
  const edgeCount = Number(r?.edge_count ?? 0);
  const ingestInProgress = Boolean(r?.ingest_in_progress);
  // Ranks-only ingest (fits a 5GB volume) serves the authority index with
  // vertex_count > 0 and edge_count === 0 — that IS ready for authority
  // lookups. Edge-dependent features gate on edgesReady instead.
  const ready = Boolean(r?.webgraph_ready) && !ingestInProgress && vertexCount > 0;
  const edgesReady = ready && Boolean(r?.edges_ready) && edgeCount > 0;
  return {
    available: true,
    ready,
    edgesReady,
    ingestInProgress,
    release: r?.release ?? null,
    ingestedAt: r?.ingested_at ?? null,
    vertexCount,
    edgeCount,
  };
}

/** Trigger a background re-ingest of a Common Crawl webgraph release. */
export async function triggerWebgraphIngest(
  release: string
): Promise<{ accepted: boolean; reason?: string }> {
  if (!isOmniDataActive()) return { accepted: false, reason: "OmniData not configured" };
  const env = await labsApiPost<{ accepted?: boolean; reason?: string }>(
    "/backlinks/webgraph/ingest",
    [{ release }]
  );
  const r = firstResult(env as DfsEnvelope<{ accepted?: boolean; reason?: string }> | null);
  return { accepted: Boolean(r?.accepted), reason: r?.reason ?? undefined };
}
