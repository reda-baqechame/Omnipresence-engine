/**
 * Keyless SERP/Maps fallback via Playwright (Chromium).
 *
 * OFF by default. Enable with OMNIDATA_ENABLE_SCRAPE=true. Cheap search APIs
 * (Serper/Bing/Brave) remain the reliable default; this only runs when no API
 * key is set, so the engine still returns real results with zero API spend.
 *
 * Notes:
 * - Google DOM selectors are fragile by nature; everything is best-effort and
 *   wrapped so a parse failure degrades to an empty result, never a crash.
 * - Requires Chromium installed (`npx playwright install chromium`).
 * - Respect target ToS / rate limits; use a proxy pool for any real scale.
 */
import type { SerpResult, SerpItem } from "../types.js";

const SCRAPE_ENABLED = process.env.OMNIDATA_ENABLE_SCRAPE === "true";
const UA =
  process.env.OMNIDATA_SCRAPE_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export function isScrapeEnabled(): boolean {
  return SCRAPE_ENABLED;
}

/**
 * Proxy pool for keyless SERP scraping at scale. Set OMNIDATA_PROXIES to a
 * comma-separated list of proxy server URLs (e.g.
 * "http://user:pass@host1:port,http://host2:port"). Requests rotate through the
 * pool round-robin so no single egress IP gets rate-limited/blocked. Empty pool
 * = direct connection (fine for low volume).
 */
export function parseProxyPool(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

let proxyCursor = 0;

/** Round-robin pick from a proxy pool; returns null when the pool is empty. */
export function pickProxy(pool: string[], cursor: number): string | null {
  if (pool.length === 0) return null;
  return pool[cursor % pool.length];
}

function nextProxy(): string | null {
  const pool = parseProxyPool(process.env.OMNIDATA_PROXIES);
  const chosen = pickProxy(pool, proxyCursor);
  if (chosen) proxyCursor += 1;
  return chosen;
}

interface BrowserLike {
  newPage(opts?: unknown): Promise<PageLike>;
  close(): Promise<void>;
}
interface PageLike {
  goto(url: string, opts?: unknown): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  close(): Promise<void>;
}
interface ChromiumLike {
  launch(opts?: unknown): Promise<BrowserLike>;
}

async function launchBrowser(): Promise<BrowserLike | null> {
  try {
    const spec = "playwright";
    const pw = (await import(spec)) as unknown as { chromium: ChromiumLike };
    const proxyServer = nextProxy();
    const launchOpts: Record<string, unknown> = { headless: true, args: ["--no-sandbox"] };
    if (proxyServer) launchOpts.proxy = { server: proxyServer };
    return await pw.chromium.launch(launchOpts);
  } catch {
    return null;
  }
}

interface ScrapedOrganic {
  title: string;
  url: string;
  description: string;
}

/** Scrape Google organic results for a keyword. Returns null if scraping is unavailable. */
export async function scrapeGoogleSerp(
  keyword: string,
  location = "United States"
): Promise<SerpResult | null> {
  if (!SCRAPE_ENABLED) return null;
  const browser = await launchBrowser();
  if (!browser) return null;

  try {
    const page = await browser.newPage({ userAgent: UA, locale: "en-US" });
    const q = encodeURIComponent(keyword);
    await page.goto(`https://www.google.com/search?q=${q}&num=20&hl=en&gl=us`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForTimeout(1200);

    const organic = await page.evaluate<ScrapedOrganic[]>(() => {
      const out: ScrapedOrganic[] = [];
      const blocks = Array.from(document.querySelectorAll("div.g, div.MjjYud"));
      for (const b of blocks) {
        const a = b.querySelector("a[href^='http']") as HTMLAnchorElement | null;
        const h3 = b.querySelector("h3");
        if (!a || !h3) continue;
        const desc =
          (b.querySelector("div[data-sncf], .VwiC3b, .lEBKkf") as HTMLElement | null)
            ?.innerText || "";
        const url = a.href;
        if (url.includes("google.com")) continue;
        out.push({ title: h3.textContent || "", url, description: desc });
      }
      return out;
    });

    await page.close();
    await browser.close();

    if (!organic.length) return null;

    const seen = new Set<string>();
    const items = organic
      .filter((o) => {
        if (seen.has(o.url)) return false;
        seen.add(o.url);
        return true;
      })
      .slice(0, 20)
      .map((o, i) => {
        let domain = "";
        try {
          domain = new URL(o.url).hostname.replace(/^www\./, "");
        } catch {
          domain = "";
        }
        return {
          type: "organic",
          rank_absolute: i + 1,
          title: o.title,
          url: o.url,
          description: o.description,
          domain,
          pixel_rank: i + 1,
        } satisfies SerpItem;
      });

    return { keyword, location, source: "playwright", items };
  } catch {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    return null;
  }
}

export interface ScrapedPlace {
  title: string;
  address?: string;
  rating?: number;
  reviews?: number;
  domain?: string;
  position: number;
}

/** Scrape Google local results (tbm=lcl) for a keyword. Returns null if unavailable. */
export async function scrapeGoogleMaps(
  keyword: string
): Promise<ScrapedPlace[] | null> {
  if (!SCRAPE_ENABLED) return null;
  const browser = await launchBrowser();
  if (!browser) return null;

  try {
    const page = await browser.newPage({ userAgent: UA, locale: "en-US" });
    const q = encodeURIComponent(keyword);
    await page.goto(`https://www.google.com/search?q=${q}&tbm=lcl&hl=en&gl=us`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForTimeout(1200);

    const places = await page.evaluate<Array<{ title: string; address?: string; rating?: number; reviews?: number }>>(
      () => {
        const out: Array<{ title: string; address?: string; rating?: number; reviews?: number }> = [];
        const cards = Array.from(document.querySelectorAll("div.VkpGBb, div.rllt__details"));
        for (const c of cards) {
          const titleEl = c.querySelector("div.dbg0pd, .OSrXXb") as HTMLElement | null;
          const title = titleEl?.innerText?.trim() || "";
          if (!title) continue;
          const text = (c as HTMLElement).innerText || "";
          const ratingMatch = text.match(/(\d\.\d)\s*\(([\d,]+)\)/);
          out.push({
            title,
            rating: ratingMatch ? Number(ratingMatch[1]) : undefined,
            reviews: ratingMatch ? Number(ratingMatch[2].replace(/,/g, "")) : undefined,
          });
        }
        return out;
      }
    );

    await page.close();
    await browser.close();

    if (!places.length) return null;
    return places.slice(0, 20).map((p, i) => ({ ...p, position: i + 1 }));
  } catch {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    return null;
  }
}
