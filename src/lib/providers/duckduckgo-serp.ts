import type { ProviderResult, SERPResult } from "./types";
import { logProviderError } from "@/lib/observability/log";

const UA = "Mozilla/5.0 (compatible; PresenceOS/1.0; +https://omnipresence-engine.vercel.app)";

function hostnameFrom(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Decode DuckDuckGo redirect URLs (//duckduckgo.com/l/?uddg=...). */
function normalizeResultUrl(raw: string): string {
  if (!raw) return "";
  if (raw.startsWith("//")) raw = `https:${raw}`;
  try {
    const u = new URL(raw);
    if (u.hostname.includes("duckduckgo.com") && u.searchParams.has("uddg")) {
      return decodeURIComponent(u.searchParams.get("uddg") || raw);
    }
    return u.toString();
  } catch {
    return raw;
  }
}

export function parseDuckDuckGoHtml(html: string): Array<{ title: string; url: string; description: string }> {
  const results: Array<{ title: string; url: string; description: string }> = [];
  const blockRe = /class="result\s[^"]*"[\s\S]*?(?=class="result\s|class="nav-link")/g;
  const blocks = html.match(blockRe) || [html];
  for (const block of blocks) {
    const link = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const url = normalizeResultUrl(link[1].replace(/<[^>]+>/g, "").trim());
    const title = link[2].replace(/<[^>]+>/g, "").trim();
    if (!url.startsWith("http") || !title) continue;
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const description = snippet ? snippet[1].replace(/<[^>]+>/g, "").trim() : "";
    results.push({ title, url, description });
    if (results.length >= 20) break;
  }
  return results;
}

/**
 * Keyless live web SERP via DuckDuckGo HTML — real measured rankings when no
 * Serper/Brave/Firecrawl key is available. Best-effort; degrades on block/rate-limit.
 */
export async function searchGoogleOrganicDuckDuckGo(
  keyword: string,
  _location = "United States",
  brandDomain: string,
  competitors: string[]
): Promise<ProviderResult<SERPResult>> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
    const html = await res.text();
    const pages = parseDuckDuckGoHtml(html);
    if (!pages.length) {
      return { success: false, error: "DuckDuckGo returned no organic results" };
    }

    const organicResults = pages.map((p, i) => ({
      title: p.title,
      url: p.url,
      position: i + 1,
    }));

    const domainLower = brandDomain.toLowerCase().replace(/^www\./, "");
    const brandInResults = organicResults.some((r) =>
      r.url.toLowerCase().includes(domainLower)
    );
    const competitorInResults: Record<string, boolean> = {};
    for (const comp of competitors) {
      const token = comp.toLowerCase().replace(/\s+/g, "");
      competitorInResults[comp] = organicResults.some((r) =>
        r.url.toLowerCase().includes(token)
      );
    }

    return {
      success: true,
      data: { organicResults, brandInResults, competitorInResults, serpFeatures: [] },
      creditsUsed: 0,
    };
  } catch (error) {
    logProviderError("duckduckgo-serp", error, { keyword });
    return {
      success: false,
      error: error instanceof Error ? error.message : "DuckDuckGo SERP failed",
    };
  }
}
