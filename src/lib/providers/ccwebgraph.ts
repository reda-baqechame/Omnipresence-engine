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
    logProviderError("ccwebgraph", error, { domain: d });
    cache.set(d, { at: Date.now(), data: null });
    return null;
  }
}

export function hasCcWebGraphCapability(): boolean {
  return process.env.CC_WEBGRAPH_DISABLED !== "true";
}
