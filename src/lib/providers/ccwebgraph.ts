import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";

const CCWG_API = process.env.CC_WEBGRAPH_API_URL || "https://ccwg-api.datasets.com";

export interface CcWebGraphSnapshot {
  year_month: string;
  pr_val_norm: number;
  hc_val_norm: number;
  pr_pos?: number;
  hc_pos?: number;
  n_hosts?: number;
}

export interface CcWebGraphResult {
  domain: string;
  /** Latest normalized PageRank 0-100 from Common Crawl webgraph. */
  pageRankNorm: number;
  /** Latest normalized harmonic centrality 0-100. */
  harmonicCentralityNorm: number;
  history: CcWebGraphSnapshot[];
  source: "commoncrawl_webgraph";
}

const cache = new Map<string, { at: number; data: CcWebGraphResult | null }>();
const TTL_MS = 6 * 60 * 60 * 1000;

// When the API host itself is unreachable (DNS failure / connection refused),
// don't retry it once per domain — that just burns latency and floods the logs
// with one warning per cited domain on every public audit. Negative-cache the
// whole endpoint and let callers fall through to the sovereign Railway
// webgraph / other authority sources.
let endpointDeadUntil = 0;
const ENDPOINT_DEAD_TTL_MS = 6 * 60 * 60 * 1000;

function isEndpointUnreachable(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  const code = cause?.code || (error as { code?: string })?.code;
  return code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "EAI_AGAIN";
}

function cleanDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase().trim();
}

/**
 * Free keyless Common Crawl WebGraph API — PageRank + harmonic centrality history.
 * Commercial-safe (public CC data). No API key required.
 */
export async function getCcWebGraphAuthority(domain: string): Promise<CcWebGraphResult | null> {
  const d = cleanDomain(domain);
  if (!d) return null;

  const cached = cache.get(d);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  if (Date.now() < endpointDeadUntil) return null;

  try {
    const res = await fetchWithTimeout(CCWG_API, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: d,
      timeoutMs: 15000,
    });
    if (!res.ok) {
      cache.set(d, { at: Date.now(), data: null });
      return null;
    }
    const json = (await res.json()) as {
      domain?: Array<CcWebGraphSnapshot>;
      host?: Array<CcWebGraphSnapshot>;
    };
    const history = (json.domain || json.host || []).filter(
      (s) => typeof s.pr_val_norm === "number"
    );
    if (!history.length) {
      cache.set(d, { at: Date.now(), data: null });
      return null;
    }
    const latest = history[history.length - 1];
    const result: CcWebGraphResult = {
      domain: d,
      pageRankNorm: latest.pr_val_norm,
      harmonicCentralityNorm: latest.hc_val_norm ?? latest.pr_val_norm,
      history,
      source: "commoncrawl_webgraph",
    };
    cache.set(d, { at: Date.now(), data: result });
    return result;
  } catch (error) {
    if (isEndpointUnreachable(error)) {
      endpointDeadUntil = Date.now() + ENDPOINT_DEAD_TTL_MS;
      logProviderError("ccwebgraph", new Error("endpoint unreachable — negative-caching for 6h"), {
        domain: d,
      });
    } else {
      logProviderError("ccwebgraph", error, { domain: d });
    }
    cache.set(d, { at: Date.now(), data: null });
    return null;
  }
}

export function hasCcWebGraphCapability(): boolean {
  return process.env.CC_WEBGRAPH_DISABLED !== "true";
}
