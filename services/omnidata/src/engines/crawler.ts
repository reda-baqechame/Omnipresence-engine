import * as cheerio from "cheerio";
import type { CrawlPage } from "../types.js";
import { isCrawlAllowed } from "../robots-guard.js";
import { isJsCrawlEnabled, launchRenderBrowser, renderPageHtml, type RenderBrowser } from "./js-render.js";

const BLOCKED = new Set(["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254"]);

export function assertPublicUrl(url: string): URL {
  const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP(S) allowed");
  }
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (BLOCKED.has(host) || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host)) {
    throw new Error("SSRF blocked");
  }
  return parsed;
}

function simhash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function computePageRank(pages: CrawlPage[]): Map<string, number> {
  const n = pages.length;
  const ranks = new Map(pages.map((p) => [p.url, 1 / n]));
  const outLinks = new Map(pages.map((p) => [p.url, p.links.filter((l) => pages.some((x) => x.url === l))]));

  for (let iter = 0; iter < 10; iter++) {
    const next = new Map<string, number>();
    for (const page of pages) {
      let sum = 0;
      for (const other of pages) {
        const links = outLinks.get(other.url) || [];
        if (links.includes(page.url)) {
          sum += (ranks.get(other.url) || 0) / Math.max(links.length, 1);
        }
      }
      next.set(page.url, 0.15 / n + 0.85 * sum);
    }
    for (const [url, rank] of next) ranks.set(url, rank);
  }
  return ranks;
}

export async function crawlSite(
  startUrl: string,
  options: { maxPages?: number; sameDomain?: boolean; jsRender?: boolean } = {}
): Promise<{
  pages: CrawlPage[];
  duplicate_clusters: Array<{ simhash: string; urls: string[] }>;
  rendered: boolean;
}> {
  const maxPages = options.maxPages ?? 25;
  const start = assertPublicUrl(startUrl);
  const domain = start.hostname.replace(/^www\./, "");
  const visited = new Set<string>();
  const queue = [start.toString()];
  const pages: CrawlPage[] = [];

  // Optional JS-rendered crawl depth (SPA coverage). Shared browser for the
  // whole crawl; null when disabled or Chromium is unavailable (static fallback).
  const useJsRender = (options.jsRender ?? isJsCrawlEnabled()) === true;
  let renderBrowser: RenderBrowser | null = null;
  if (useJsRender) renderBrowser = await launchRenderBrowser();
  let rendered = false;

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    if (!(await isCrawlAllowed(url, domain))) continue;
    visited.add(url);

    try {
      let html: string | null = null;
      let status = 200;
      if (renderBrowser) {
        html = await renderPageHtml(renderBrowser, url);
        if (html) rendered = true;
      }
      if (html == null) {
        const res = await fetch(url, {
          headers: { "User-Agent": "OmniData-Crawler/1.0" },
          signal: AbortSignal.timeout(10000),
        });
        status = res.status;
        html = await res.text();
      }
      const $ = cheerio.load(html);
      const title = $("title").first().text().trim();
      const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 5000);
      const links: string[] = [];
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        try {
          const abs = new URL(href, url);
          if (options.sameDomain !== false) {
            const h = abs.hostname.replace(/^www\./, "");
            if (h !== domain && !h.endsWith(`.${domain}`)) return;
          }
          assertPublicUrl(abs.toString());
          links.push(abs.toString());
          if (!visited.has(abs.toString())) queue.push(abs.toString());
        } catch {
          // skip invalid
        }
      });
      pages.push({
        url,
        status,
        title,
        links: [...new Set(links)],
        simhash: simhash(text),
        pagerank: 0,
      });
    } catch {
      pages.push({ url, status: 0, links: [], simhash: "", pagerank: 0 });
    }
  }

  if (renderBrowser) {
    try {
      await renderBrowser.close();
    } catch {
      /* ignore */
    }
  }

  const pr = computePageRank(pages);
  for (const page of pages) {
    page.pagerank = pr.get(page.url) || 0;
  }

  const hashGroups = new Map<string, string[]>();
  for (const p of pages) {
    if (!p.simhash) continue;
    const g = hashGroups.get(p.simhash) || [];
    g.push(p.url);
    hashGroups.set(p.simhash, g);
  }
  const duplicate_clusters = [...hashGroups.entries()]
    .filter(([, urls]) => urls.length > 1)
    .map(([simhash, urls]) => ({ simhash, urls }));

  return { pages, duplicate_clusters, rendered };
}
