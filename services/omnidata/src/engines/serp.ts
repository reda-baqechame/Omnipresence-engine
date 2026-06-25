import type { SerpItem, SerpResult } from "../types.js";

const BING_KEY = process.env.BING_SEARCH_API_KEY;
const SERPER_KEY = process.env.SERPER_API_KEY;
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function toDataForSeoItems(result: SerpResult): SerpItem[] {
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
  return result;
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
  const result =
    (await searchSerper(keyword)) ||
    (await searchBing(keyword)) ||
    (await searchBrave(keyword)) || {
      keyword,
      location,
      source: "simulated" as const,
      items: [
        {
          type: "organic",
          rank_absolute: 1,
          title: `Results for ${keyword}`,
          url: `https://www.google.com/search?q=${encodeURIComponent(keyword)}`,
          description: "Configure SERPER_API_KEY, BING_SEARCH_API_KEY, or BRAVE_SEARCH_API_KEY for live SERP.",
          pixel_rank: 1,
        },
      ],
    };

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
