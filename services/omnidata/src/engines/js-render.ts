/**
 * Optional JS-rendered crawl depth (the runnable equivalent of Katana, MIT).
 *
 * OFF by default. Enable with OMNIDATA_ENABLE_JS_CRAWL=true to render SPA /
 * client-rendered pages with the already-bundled Chromium before extracting
 * links and content. Falls back to plain fetch when Chromium is unavailable, so
 * the crawler never crashes — it just degrades to static HTML coverage.
 *
 * Katana (github.com/projectdiscovery/katana) is MIT-licensed; rather than ship
 * its Go binary, we use Playwright (already a dependency) to get the same
 * headless JS-rendered coverage with zero extra runtime.
 */

const JS_CRAWL_ENABLED = process.env.OMNIDATA_ENABLE_JS_CRAWL === "true";
const UA =
  process.env.OMNIDATA_SCRAPE_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export function isJsCrawlEnabled(): boolean {
  return JS_CRAWL_ENABLED;
}

interface PageLike {
  goto(url: string, opts?: unknown): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  content(): Promise<string>;
  close(): Promise<void>;
}
interface BrowserLike {
  newPage(opts?: unknown): Promise<PageLike>;
  close(): Promise<void>;
}
interface ChromiumLike {
  launch(opts?: unknown): Promise<BrowserLike>;
}

/** Launch a shared Chromium instance for a crawl, or null if Playwright/Chromium is missing. */
export async function launchRenderBrowser(): Promise<BrowserLike | null> {
  if (!JS_CRAWL_ENABLED) return null;
  try {
    const spec = "playwright";
    const pw = (await import(spec)) as unknown as { chromium: ChromiumLike };
    return await pw.chromium.launch({ headless: true, args: ["--no-sandbox"] });
  } catch {
    return null;
  }
}

/** Render a single URL to its post-JS HTML. Returns null on any failure (caller falls back to fetch). */
export async function renderPageHtml(browser: BrowserLike, url: string): Promise<string | null> {
  let page: PageLike | null = null;
  try {
    page = await browser.newPage({ userAgent: UA, locale: "en-US" });
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(600);
    const html = await page.content();
    return html || null;
  } catch {
    return null;
  } finally {
    try {
      await page?.close();
    } catch {
      /* ignore */
    }
  }
}

export type { BrowserLike as RenderBrowser };
