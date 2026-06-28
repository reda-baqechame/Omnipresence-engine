import type { ProviderResult, CrawlResult, SERPResult } from "./types";
import { logProviderError } from "@/lib/observability/log";

/** True only when a real (non-placeholder) Firecrawl key is configured. */
export function hasFirecrawlCapability(): boolean {
  const k = process.env.FIRECRAWL_API_KEY;
  return Boolean(k && k.trim() && !k.startsWith("your-"));
}

interface FirecrawlSearchItem {
  url?: string;
  title?: string;
  description?: string;
}

function hostnameFrom(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Real Google organic SERP via Firecrawl's /v1/search (live Google results).
 * This is the keyless-by-default SERP path in production: whenever a Firecrawl
 * key exists we can measure real brand ranking + presence without a dedicated
 * SERP API. Returns the same SERPResult contract as Serper/Brave so the router
 * and visibility scanner treat it as fully measured (grounded) data.
 */
export async function searchGoogleOrganicFirecrawl(
  keyword: string,
  location = "United States",
  brandDomain = "",
  competitors: string[] = []
): Promise<ProviderResult<SERPResult>> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!hasFirecrawlCapability() || !apiKey) {
    return { success: false, error: "Firecrawl not configured" };
  }
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: keyword, limit: 20, location }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      // Some Firecrawl plans reject the `location` field — retry once without it.
      if (response.status === 400) {
        const retry = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: keyword, limit: 20 }),
          signal: AbortSignal.timeout(30000),
        });
        if (!retry.ok) throw new Error(`Firecrawl search error: ${retry.status}`);
        return parseFirecrawlSearch(await retry.json(), brandDomain, competitors);
      }
      throw new Error(`Firecrawl search error: ${response.status}`);
    }

    return parseFirecrawlSearch(await response.json(), brandDomain, competitors);
  } catch (error) {
    logProviderError("firecrawl.search", error, { keyword, location });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Firecrawl search failed",
    };
  }
}

function parseFirecrawlSearch(
  raw: unknown,
  brandDomain: string,
  competitors: string[]
): ProviderResult<SERPResult> {
  const items = ((raw as { data?: FirecrawlSearchItem[] })?.data || []).filter((i) => i.url);
  const organicResults = items.map((item, index) => ({
    title: item.title || "",
    url: item.url || "",
    position: index + 1,
  }));

  const domainLower = brandDomain.toLowerCase().replace(/^www\./, "");

  const brandInResults = Boolean(
    domainLower &&
      organicResults.some(
        (r) => hostnameFrom(r.url) === domainLower || hostnameFrom(r.url).endsWith(`.${domainLower}`)
      )
  );

  const competitorInResults: Record<string, boolean> = {};
  for (const comp of competitors) {
    const compToken = comp.toLowerCase().replace(/\s+/g, "");
    competitorInResults[comp] = organicResults.some((r) =>
      hostnameFrom(r.url).replace(/\..*$/, "").includes(compToken)
    );
  }

  return {
    success: true,
    data: { organicResults, aiOverview: undefined, brandInResults, competitorInResults },
    creditsUsed: 1,
  };
}

export async function scrapePage(url: string): Promise<ProviderResult<CrawlResult>> {
  if (hasFirecrawlCapability()) {
    return scrapeWithFirecrawl(url, process.env.FIRECRAWL_API_KEY!);
  }

  return scrapeWithFetch(url);
}

async function scrapeWithFirecrawl(
  url: string,
  apiKey: string
): Promise<ProviderResult<CrawlResult>> {
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["html", "markdown"],
        onlyMainContent: false,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Firecrawl error: ${response.status}`);
    }

    const data = (await response.json()) as {
      data: {
        metadata: {
          title?: string;
          description?: string;
          canonical?: string;
          statusCode?: number;
          robots?: string;
        };
        html?: string;
      };
    };

    const html = data.data?.html || "";
    const metadata = data.data?.metadata || {};

    return {
      success: true,
      data: parseHtmlContent(url, html, metadata),
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Firecrawl scrape failed",
    };
  }
}

async function scrapeWithFetch(url: string): Promise<ProviderResult<CrawlResult>> {
  try {
    const fullUrl = url.startsWith("http") ? url : `https://${url}`;
    const response = await fetch(fullUrl, {
      headers: {
        "User-Agent": "PresenceOS-Audit/1.0 (+https://presenceos.app)",
      },
      signal: AbortSignal.timeout(15000),
    });

    const html = await response.text();
    return {
      success: true,
      data: parseHtmlContent(fullUrl, html, {
        statusCode: response.status,
      }),
      creditsUsed: 0,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Fetch scrape failed",
    };
  }
}

function parseHtmlContent(
  url: string,
  html: string,
  metadata: { title?: string; description?: string; canonical?: string; statusCode?: number; robots?: string }
): CrawlResult {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const metaDescMatch = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i
  );
  const canonicalMatch = html.match(
    /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i
  );
  const noindexMatch = html.match(
    /<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i
  );

  const schemaMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const schemaJson: unknown[] = [];
  const schemaTypes: string[] = [];

  for (const match of schemaMatches) {
    try {
      const parsed = JSON.parse(match[1]);
      schemaJson.push(parsed);
      if (parsed["@type"]) {
        const types = Array.isArray(parsed["@type"]) ? parsed["@type"] : [parsed["@type"]];
        schemaTypes.push(...types);
      }
    } catch {
      // Invalid JSON-LD
    }
  }

  const headingMatches = [...html.matchAll(/<h([1-6])[^>]*>([^<]*)<\/h\1>/gi)];
  const headings = headingMatches.map((m) => ({
    level: parseInt(m[1]),
    text: m[2].replace(/<[^>]*>/g, "").trim(),
  }));

  const imgMatches = [...html.matchAll(/<img[^>]*src=["']([^"']*)["'][^>]*(?:alt=["']([^"']*)["'])?/gi)];
  const images = imgMatches.map((m) => ({ src: m[1], alt: m[2] }));

  const linkMatches = [...html.matchAll(/<a[^>]*href=["']([^"']*)["']/gi)];
  const baseDomain = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();

  const internalLinks: string[] = [];
  const externalLinks: string[] = [];

  for (const match of linkMatches) {
    const href = match[1];
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    try {
      const linkDomain = new URL(href, url).hostname;
      if (linkDomain === baseDomain || href.startsWith("/")) {
        internalLinks.push(href);
      } else {
        externalLinks.push(href);
      }
    } catch {
      // Invalid URL
    }
  }

  const textContent = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  const blockMatches = [
    ...html.matchAll(/<(p|li)[^>]*>([\s\S]*?)<\/\1>/gi),
  ];
  const paragraphs = blockMatches
    .map((m) => m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0);

  return {
    url,
    title: metadata.title || titleMatch?.[1]?.trim(),
    metaDescription: metadata.description || metaDescMatch?.[1]?.trim(),
    canonical: metadata.canonical || canonicalMatch?.[1]?.trim(),
    schemaTypes: [...new Set(schemaTypes)],
    schemaJson,
    headings,
    images,
    internalLinks: [...new Set(internalLinks)],
    externalLinks: [...new Set(externalLinks)],
    wordCount: textContent.split(/\s+/).length,
    hasNoindex: !!noindexMatch || metadata.robots?.includes("noindex") || false,
    statusCode: metadata.statusCode || 200,
    textContent,
    paragraphs,
  };
}

export async function crawlSite(
  domain: string,
  maxPages = 20
): Promise<ProviderResult<CrawlResult[]>> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  const url = domain.startsWith("http") ? domain : `https://${domain}`;

  if (hasFirecrawlCapability()) {
    try {
      const response = await fetch("https://api.firecrawl.dev/v1/crawl", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          limit: maxPages,
          scrapeOptions: { formats: ["html"] },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`Firecrawl crawl error: ${response.status}`);
      }

      const data = (await response.json()) as { id: string };
      // Poll for results (simplified — in production use webhook)
      await new Promise((r) => setTimeout(r, 5000));

      const statusRes = await fetch(`https://api.firecrawl.dev/v1/crawl/${data.id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30000),
      });
      const statusData = (await statusRes.json()) as {
        data: Array<{ metadata: Record<string, string>; html?: string }>;
      };

      const results = (statusData.data || []).map((page) =>
        parseHtmlContent(page.metadata?.sourceURL || url, page.html || "", page.metadata)
      );

      return { success: true, data: results, creditsUsed: maxPages };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Crawl failed",
      };
    }
  }

  const homepage = await scrapePage(url);
  return homepage.success && homepage.data
    ? { success: true, data: [homepage.data], creditsUsed: 1 }
    : { success: false, error: homepage.error };
}
