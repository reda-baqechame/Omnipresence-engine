import * as cheerio from "cheerio";

export interface PageScrapeIntel {
  url: string;
  title?: string;
  metaDescription?: string;
  headings: Array<{ level: number; text: string }>;
  schemaTypes: string[];
  wordCount: number;
  internalLinks: number;
  externalLinks: number;
}

/** Direct fetch scrape when Firecrawl is unavailable. */
export async function scrapePageDirect(url: string): Promise<PageScrapeIntel | null> {
  const target = url.startsWith("http") ? url : `https://${url}`;
  try {
    const res = await fetch(target, {
      headers: { "User-Agent": "PresenceOS-Scraper/1.0", Accept: "text/html" },
      signal: AbortSignal.timeout(12000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const title = $("title").first().text().trim();
    const metaDescription =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";

    const headings: Array<{ level: number; text: string }> = [];
    $("h1, h2, h3").each((_, el) => {
      const tag = (el as { tagName?: string }).tagName?.toLowerCase();
      const level = tag === "h1" ? 1 : tag === "h2" ? 2 : 3;
      const text = $(el).text().trim();
      if (text) headings.push({ level, text });
    });

    const schemaTypes: string[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html() || "{}") as { "@type"?: string | string[] };
        const types = json["@type"];
        if (typeof types === "string") schemaTypes.push(types);
        if (Array.isArray(types)) schemaTypes.push(...types);
      } catch {
        // skip invalid JSON-LD
      }
    });

    const text = $("body").text().replace(/\s+/g, " ").trim();
    const origin = new URL(target);
    let internal = 0;
    let external = 0;
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
      try {
        const abs = new URL(href, target);
        if (abs.hostname.replace(/^www\./, "") === origin.hostname.replace(/^www\./, "")) internal++;
        else external++;
      } catch {
        // skip
      }
    });

    return {
      url: target,
      title,
      metaDescription,
      headings,
      schemaTypes: [...new Set(schemaTypes)],
      wordCount: text.split(/\s+/).filter(Boolean).length,
      internalLinks: internal,
      externalLinks: external,
    };
  } catch {
    return null;
  }
}
