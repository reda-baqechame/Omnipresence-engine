import type { SerpItem, SerpResult } from "../types.js";
import { scrapeGoogleSerp } from "./scrape.js";

const BING_KEY = process.env.BING_SEARCH_API_KEY;
const SERPER_KEY = process.env.SERPER_API_KEY;
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

/**
 * Pure SERP decomposition: a provider-agnostic SerpResult → DataForSEO-shaped
 * item list (featured snippet, AI Overview + sources, ranked organic, PAA, local
 * pack). Exported so the parser contract can be audited offline against a known
 * fixture, independent of which live SERP backend produced the SerpResult.
 */
export function toDataForSeoItems(result: SerpResult): SerpItem[] {
  const items: SerpItem[] = [];
  let rank = 1;

  if (result.featured_snippet) {
    items.push({
      type: "featured_snippet",
      rank_absolute: 0,
      title: result.featured_snippet.title,
      url: result.featured_snippet.url,
      description: result.featured_snippet.description,
    });
  }

  if (result.ai_overview) {
    items.push({
      type: "ai_overview",
      rank_absolute: 0,
      title: "AI Overview",
      description: result.ai_overview.text,
      items: result.ai_overview.sources.map((s) => ({
        type: "link_element",
        title: s.title,
        url: s.url,
      })),
    });
  }

  for (const organic of result.items) {
    items.push({
      type: "organic",
      rank_absolute: organic.rank_absolute ?? rank,
      rank_group: rank,
      title: organic.title,
      url: organic.url,
      description: organic.description,
      domain: organic.domain || domainFromUrl(organic.url || ""),
      pixel_rank: organic.pixel_rank ?? rank,
    });
    rank++;
  }

  if (result.people_also_ask?.length) {
    items.push({
      type: "people_also_ask",
      items: result.people_also_ask.map((p) => ({
        type: "people_also_ask_element",
        title: p.question,
        description: p.answer,
      })),
    });
  }

  if (result.local_pack?.length) {
    items.push({
      type: "local_pack",
      items: result.local_pack.map((l, i) => ({
        type: "local_pack_element",
        rank_absolute: i + 1,
        title: l.title,
        url: l.url,
        description: l.description,
      })),
    });
  }

  return items;
}

async function searchBing(keyword: string): Promise<SerpResult | null> {
  if (!BING_KEY) return null;
  const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(keyword)}&count=20`;
  const res = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": BING_KEY } });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    webPages?: { value?: Array<{ name: string; url: string; snippet: string }> };
  };
  const pages = data.webPages?.value || [];
  if (!pages.length) return null;
  return {
    keyword,
    location: "United States",
    source: "bing_api",
    items: pages.map((p, i) => ({
      type: "organic",
      rank_absolute: i + 1,
      title: p.name,
      url: p.url,
      description: p.snippet,
      domain: domainFromUrl(p.url),
      pixel_rank: i + 1,
    })),
  };
}

async function searchBingHtml(keyword: string): Promise<SerpResult | null> {
  try {
    const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(keyword)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OmniData/1.0)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const items: SerpItem[] = [];
    const blockRe = /<li class="b_algo"[\s\S]*?<\/li>/g;
    const blocks = html.match(blockRe) || [];
    let rank = 1;
    for (const block of blocks) {
      const link = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!link) continue;
      const url = decodeHtmlEntities(link[1].trim());
      const title = decodeHtmlEntities(link[2].replace(/<[^>]+>/g, "").trim());
      if (!url.startsWith("http") || !title) continue;
      const snippet = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      items.push({
        type: "organic",
        rank_absolute: rank,
        title,
        url,
        description: snippet ? decodeHtmlEntities(snippet[1].replace(/<[^>]+>/g, "").trim()) : "",
        domain: domainFromUrl(url),
        pixel_rank: rank,
      });
      rank++;
      if (items.length >= 20) break;
    }
    if (!items.length) return null;
    return { keyword, location: "United States", source: "bing_html", items };
  } catch {
    return null;
  }
}

async function searchSerper(keyword: string): Promise<SerpResult | null> {
  if (!SERPER_KEY) return null;
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": SERPER_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q: keyword, num: 20 }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    organic?: Array<{ title: string; link: string; snippet: string; position: number }>;
    answerBox?: { title?: string; link?: string; snippet?: string };
    peopleAlsoAsk?: Array<{ question: string; snippet?: string }>;
    places?: Array<{ title: string; link?: string; address?: string }>;
  };
  const result: SerpResult = {
    keyword,
    location: "United States",
    source: "serper",
    items: (data.organic || []).map((o) => ({
      type: "organic",
      rank_absolute: o.position,
      title: o.title,
      url: o.link,
      description: o.snippet,
      domain: domainFromUrl(o.link),
      pixel_rank: o.position,
    })),
  };
  if (data.answerBox) {
    result.featured_snippet = {
      type: "featured_snippet",
      title: data.answerBox.title,
      url: data.answerBox.link,
      description: data.answerBox.snippet,
    };
  }
  if (data.peopleAlsoAsk) {
    result.people_also_ask = data.peopleAlsoAsk.map((p) => ({
      question: p.question,
      answer: p.snippet,
    }));
  }
  if (data.places) {
    result.local_pack = data.places.map((p) => ({
      type: "local_pack_element",
      title: p.title,
      url: p.link,
      description: p.address,
    }));
  }
  if (!result.items.length && !result.featured_snippet && !result.local_pack?.length) return null;
  return result;
}

async function searchFirecrawl(keyword: string): Promise<SerpResult | null> {
  if (!FIRECRAWL_KEY || FIRECRAWL_KEY.startsWith("your-")) return null;
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: keyword, limit: 20 }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: Array<{ url?: string; title?: string; description?: string }>;
      web?: Array<{ url?: string; title?: string; description?: string }>;
    };
    const pages = data.data || data.web || [];
    if (!pages.length) return null;
    return {
      keyword,
      location: "United States",
      source: "firecrawl",
      items: pages.map((p, i) => ({
        type: "organic",
        rank_absolute: i + 1,
        title: p.title || "",
        url: p.url || "",
        description: p.description || "",
        domain: domainFromUrl(p.url || ""),
        pixel_rank: i + 1,
      })),
    };
  } catch {
    return null;
  }
}

async function searchDuckDuckGo(keyword: string): Promise<SerpResult | null> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OmniData/1.0)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const items: SerpItem[] = [];
    const blockRe = /class="result\s[^"]*"[\s\S]*?(?=class="result\s|class="nav-link")/g;
    const blocks = html.match(blockRe) || [html];
    let rank = 1;
    for (const block of blocks) {
      const link = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!link) continue;
      let rawUrl = link[1].trim();
      if (rawUrl.startsWith("//")) rawUrl = `https:${rawUrl}`;
      let url = rawUrl;
      try {
        const u = new URL(rawUrl);
        if (u.hostname.includes("duckduckgo.com") && u.searchParams.has("uddg")) {
          url = decodeURIComponent(u.searchParams.get("uddg") || rawUrl);
        }
      } catch {
        /* keep raw */
      }
      const title = decodeHtmlEntities(link[2].replace(/<[^>]+>/g, "").trim());
      if (!url.startsWith("http") || !title) continue;
      const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      items.push({
        type: "organic",
        rank_absolute: rank,
        title,
        url,
        description: snippet ? decodeHtmlEntities(snippet[1].replace(/<[^>]+>/g, "").trim()) : "",
        domain: domainFromUrl(url),
        pixel_rank: rank,
      });
      rank++;
      if (items.length >= 20) break;
    }
    if (!items.length) return null;
    return { keyword, location: "United States", source: "duckduckgo", items };
  } catch {
    return null;
  }
}

async function searchBrave(keyword: string): Promise<SerpResult | null> {
  if (!BRAVE_KEY) return null;
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(keyword)}&count=20`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": BRAVE_KEY },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    web?: { results?: Array<{ title: string; url: string; description: string }> };
  };
  const pages = data.web?.results || [];
  if (!pages.length) return null;
  return {
    keyword,
    location: "United States",
    source: "brave",
    items: pages.map((p, i) => ({
      type: "organic",
      rank_absolute: i + 1,
      title: p.title,
      url: p.url,
      description: p.description,
      domain: domainFromUrl(p.url),
      pixel_rank: i + 1,
    })),
  };
}

async function fetchAutocomplete(keyword: string): Promise<string[]> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(keyword)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as [string, string[]];
    return (data[1] || []).slice(0, 10);
  } catch {
    return [];
  }
}

export async function runSerpLive(keyword: string, location = "United States"): Promise<{
  tasks: Array<{ result: Array<{ items: SerpItem[]; keyword: string; location_name: string }> }>;
}> {
  let result: SerpResult | null = null;
  for (const search of [searchSerper, searchBing, searchBrave, searchBingHtml, searchDuckDuckGo, searchFirecrawl]) {
    const candidate = await search(keyword);
    if (candidate?.items?.length) {
      result = candidate;
      break;
    }
  }
  if (!result) {
    // Keyless fallback (env-gated): real results with no API key/spend.
    result = await scrapeGoogleSerp(keyword, location);
  }

  if (!result) {
    return {
      tasks: [
        {
          result: [
            {
              keyword,
              location_name: location,
              items: [],
            },
          ],
        },
      ],
    };
  }

  const related = await fetchAutocomplete(keyword);
  if (related.length && !result.people_also_ask) {
    result.people_also_ask = related.slice(0, 5).map((q) => ({ question: q }));
  }

  const items = toDataForSeoItems(result);
  return {
    tasks: [
      {
        result: [
          {
            keyword,
            location_name: location,
            items,
          },
        ],
      },
    ],
  };
}

export function findDomainPosition(items: SerpItem[], domain: string): {
  position: number | null;
  url?: string;
  features: string[];
} {
  const normalized = domain.replace(/^www\./, "").toLowerCase();
  const features: string[] = [];
  for (const item of items) {
    if (item.type === "featured_snippet") features.push("featured_snippet");
    if (item.type === "ai_overview") features.push("ai_overview");
    if (item.type === "local_pack") features.push("local_pack");
    if (item.type === "people_also_ask") features.push("people_also_ask");
    if (item.type === "organic") {
      const d = (item.domain || domainFromUrl(item.url || "")).toLowerCase();
      if (d === normalized || d.endsWith(`.${normalized}`)) {
        return { position: item.rank_absolute ?? null, url: item.url, features };
      }
    }
  }
  return { position: null, features };
}
