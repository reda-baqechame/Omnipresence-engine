import { chromium, type Browser, type BrowserContext } from "playwright";

export type Surface = "chatgpt" | "gemini" | "perplexity" | "google_ai_overview";

export interface RawCapture {
  answer: string;
  citedUrls: string[];
}

/**
 * Grounded AI UI capture via a real browser.
 *
 * IMPORTANT / honesty + ToS:
 *  - This is a self-hosted, opt-in service. Operators are responsible for
 *    complying with each platform's Terms of Service and robots policy.
 *  - Keyless public surfaces (Perplexity, Google AI Overview) can be captured
 *    without login. Logged-in surfaces (ChatGPT, Gemini) require a persisted
 *    storage state (AI_UI_CAPTURE_STORAGE_STATE) that the operator supplies;
 *    without it we return null rather than fake an answer.
 */

let browserPromise: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: process.env.AI_UI_CAPTURE_HEADFUL !== "true" });
  }
  return browserPromise;
}

async function newContext(browser: Browser): Promise<BrowserContext> {
  const storageState = process.env.AI_UI_CAPTURE_STORAGE_STATE || undefined;
  return browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    locale: "en-US",
    storageState,
  });
}

const NAV_TIMEOUT = Number(process.env.AI_UI_CAPTURE_TIMEOUT_MS || 45000);

function externalLinks(hrefs: string[]): string[] {
  const skip = ["google.com", "perplexity.ai", "gstatic.com", "googleusercontent.com", "youtube.com/redirect", "accounts.google", "support.google"];
  return [...new Set(hrefs)]
    .filter((h) => /^https?:\/\//i.test(h))
    .filter((h) => !skip.some((s) => h.includes(s)));
}

async function capturePerplexity(ctx: BrowserContext, prompt: string): Promise<RawCapture | null> {
  const page = await ctx.newPage();
  try {
    await page.goto(`https://www.perplexity.ai/search?q=${encodeURIComponent(prompt)}`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    // Wait for the answer prose to render.
    await page.waitForSelector("main", { timeout: NAV_TIMEOUT });
    await page.waitForTimeout(6000);
    const answer = (await page.locator("main").innerText().catch(() => "")) || "";
    const hrefs = await page.locator("a").evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href).filter(Boolean)
    );
    if (!answer.trim()) return null;
    return { answer, citedUrls: externalLinks(hrefs) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function captureGoogleAiOverview(ctx: BrowserContext, prompt: string): Promise<RawCapture | null> {
  const page = await ctx.newPage();
  try {
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(prompt)}`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    await page.waitForTimeout(5000);
    // AI Overview container selectors drift; try a few, fall back to top of page.
    const candidates = ["[data-attrid='AIOverview']", "div[jsname][data-mcpr]", "#rso"];
    let answer = "";
    for (const sel of candidates) {
      const loc = page.locator(sel).first();
      if (await loc.count().catch(() => 0)) {
        answer = (await loc.innerText().catch(() => "")) || "";
        if (answer.trim()) break;
      }
    }
    const hrefs = await page.locator("a").evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href).filter(Boolean)
    );
    if (!answer.trim()) return null;
    return { answer, citedUrls: externalLinks(hrefs) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function captureAuthedChat(ctx: BrowserContext, surface: "chatgpt" | "gemini", prompt: string): Promise<RawCapture | null> {
  if (!process.env.AI_UI_CAPTURE_STORAGE_STATE) {
    // No logged-in session provided — do not fake a logged-out experience.
    return null;
  }
  const page = await ctx.newPage();
  try {
    const url = surface === "chatgpt" ? "https://chatgpt.com/" : "https://gemini.google.com/app";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    const box = page.locator("textarea, div[contenteditable='true']").first();
    await box.waitFor({ timeout: NAV_TIMEOUT });
    await box.click();
    await box.fill(prompt);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(12000);
    const answer = (await page.locator("main").innerText().catch(() => "")) || "";
    const hrefs = await page.locator("main a").evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href).filter(Boolean)
    );
    if (!answer.trim()) return null;
    return { answer, citedUrls: externalLinks(hrefs) };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function capture(surface: Surface, prompt: string): Promise<RawCapture | null> {
  const browser = await getBrowser();
  const ctx = await newContext(browser);
  try {
    if (surface === "perplexity") return await capturePerplexity(ctx, prompt);
    if (surface === "google_ai_overview") return await captureGoogleAiOverview(ctx, prompt);
    return await captureAuthedChat(ctx, surface, prompt);
  } catch {
    return null;
  } finally {
    await ctx.close().catch(() => {});
  }
}
