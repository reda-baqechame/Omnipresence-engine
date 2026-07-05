import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";

const RADAR_BASE = "https://api.cloudflare.com/client/v4/radar";

function hasToken(): boolean {
  const t = process.env.CLOUDFLARE_RADAR_API_TOKEN;
  return Boolean(t && t.length > 0 && !t.startsWith("your-"));
}

export interface RadarDomainRank {
  domain: string;
  /** Bucket label e.g. top_100k, top_1m — Radar does not expose exact rank for most domains. */
  rankBucket: string | null;
  /** Internal blended score 0-100 for UI (not absolute visits). */
  popularityScore: number;
  source: "cloudflare_radar";
  /** CC BY-NC 4.0 — internal signal; cite Cloudflare Radar in methodology. */
  license: "CC-BY-NC-4.0";
}

const cache = new Map<string, { at: number; data: RadarDomainRank | null }>();
const TTL_MS = 24 * 60 * 60 * 1000;

function bucketToScore(bucket: string | null | undefined): number {
  if (!bucket) return 0;
  const b = bucket.toLowerCase();
  if (b.includes("top_100") && !b.includes("k")) return 95;
  if (b.includes("top_1k")) return 90;
  if (b.includes("top_10k")) return 80;
  if (b.includes("top_100k")) return 65;
  if (b.includes("top_200k")) return 55;
  if (b.includes("top_1m")) return 40;
  if (b.includes("top_10m")) return 25;
  return 15;
}

/**
 * Cloudflare Radar domain ranking — free API, CC BY-NC 4.0.
 * Used as an internal blended popularity signal alongside Tranco/rank.to/CCWG.
 */
export async function getRadarDomainRank(domain: string): Promise<RadarDomainRank | null> {
  if (!hasToken()) return null;
  const d = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  if (!d) return null;

  const cached = cache.get(d);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  try {
    const url = `${RADAR_BASE}/ranking/domain/${encodeURIComponent(d)}?format=JSON`;
    const res = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_RADAR_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeoutMs: 12000,
    });
    if (!res.ok) {
      cache.set(d, { at: Date.now(), data: null });
      return null;
    }
    const json = (await res.json()) as {
      result?: { rank?: string; categories?: string[] };
    };
    const bucket = json.result?.rank ?? null;
    const result: RadarDomainRank = {
      domain: d,
      rankBucket: bucket,
      popularityScore: bucketToScore(bucket),
      source: "cloudflare_radar",
      license: "CC-BY-NC-4.0",
    };
    cache.set(d, { at: Date.now(), data: result });
    return result;
  } catch (error) {
    logProviderError("cloudflare-radar", error, { domain: d });
    cache.set(d, { at: Date.now(), data: null });
    return null;
  }
}

export function hasCloudflareRadarCapability(): boolean {
  return hasToken();
}
