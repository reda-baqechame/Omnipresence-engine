import { createHash } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export type Surface =
  | "chatgpt"
  | "gemini"
  | "perplexity"
  | "google_ai_overview"
  | "bing_copilot";

export interface CaptureOptions {
  /** ISO country (e.g. "US", "GB") to bias locale + Accept-Language + Google gl. */
  geo?: string;
  /** BCP-47 locale (e.g. "en-US"); defaults from geo or en-US. */
  locale?: string;
  /** IANA timezone (e.g. "America/New_York") for the browser context. */
  timezone?: string;
  /** Named persona shaping the user-agent (desktop|mobile) — never fabricates content. */
  persona?: "desktop" | "mobile";
  /** Capture heavy evidence artifacts (screenshot + DOM). Default true. */
  withEvidence?: boolean;
}

export interface RawCapture {
  answer: string;
  citedUrls: string[];
  /** sha256 of the answer text (tamper-evident fingerprint). */
  responseHash: string;
  /** Base64 PNG screenshot of the answer surface (when withEvidence). */
  screenshotBase64?: string;
  /** Full DOM HTML snapshot of the page (when withEvidence). */
  domHtml?: string;
  /** Effective geo/locale/persona the capture actually ran under (provenance). */
  context: { geo?: string; locale: string; timezone?: string; persona: "desktop" | "mobile" };
}

/** Returned when a surface is blocked (captcha / rate-limit / consent wall). */
export interface BlockedCapture {
  blocked: true;
  reason: string;
}

export type CaptureOutcome = RawCapture | BlockedCapture | null;

export function isBlocked(x: CaptureOutcome): x is BlockedCapture {
  return Boolean(x) && (x as BlockedCapture).blocked === true;
}

/**
 * Grounded AI UI capture via a real browser.
 *
 * IMPORTANT / honesty + ToS:
 *  - This is a self-hosted, opt-in service. Operators are responsible for
 *    complying with each platform's Terms of Service and robots policy.
 *  - Keyless public surfaces (Perplexity, Google AI Overview, Bing Copilot) can
 *    be captured without login. Logged-in surfaces (ChatGPT, Gemini) require a
 *    persisted storage state (AI_UI_CAPTURE_STORAGE_STATE) the operator supplies;
 *    without it we return null rather than fake an answer.
 *  - When a surface is rate-limited / captcha-walled / consent-gated we return an
 *    explicit `blocked` outcome — we NEVER fabricate an answer.
 */

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

let browserPromise: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: process.env.AI_UI_CAPTURE_HEADFUL !== "true" });
  }
  return browserPromise;
}

function localeForGeo(geo?: string): string {
  if (!geo) return "en-US";
  const g = geo.toUpperCase();
  return /^[A-Z]{2}$/.test(g) ? `en-${g}` : "en-US";
}

async function newContext(browser: Browser, opts: CaptureOptions): Promise<BrowserContext> {
  const storageState = process.env.AI_UI_CAPTURE_STORAGE_STATE || undefined;
  const persona = opts.persona === "mobile" ? "mobile" : "desktop";
  const locale = opts.locale || localeForGeo(opts.geo);
  return browser.newContext({
    userAgent: persona === "mobile" ? MOBILE_UA : DESKTOP_UA,
    locale,
    timezoneId: opts.timezone,
    extraHTTPHeaders: { "Accept-Language": `${locale},en;q=0.8` },
    ...(persona === "mobile" ? { viewport: { width: 390, height: 844 }, isMobile: true } : {}),
    storageState,
  });
}

const NAV_TIMEOUT = Number(process.env.AI_UI_CAPTURE_TIMEOUT_MS || 45000);

function externalLinks(hrefs: string[]): string[] {
  const skip = ["google.com", "perplexity.ai", "gstatic.com", "googleusercontent.com", "youtube.com/redirect", "accounts.google", "support.google", "bing.com/search", "go.microsoft.com"];
  return [...new Set(hrefs)]
    .filter((h) => /^https?:\/\//i.test(h))
    .filter((h) => !skip.some((s) => h.includes(s)));
}

const BLOCK_SIGNALS = [
  "unusual traffic",
  "are you a robot",
  "verify you are human",
  "captcha",
  "recaptcha",
  "/sorry/",
  "detected unusual",
  "too many requests",
  "rate limit",
  "before you continue to google",
  "consent.google",
];

/**
 * Pure block detector: decide from page URL + visible text whether the surface
 * served a captcha / consent / rate-limit wall instead of a real answer. Pure so
 * it can be unit-tested without a browser.
 */
export function detectBlock(url: string, text: string): string | null {
  const hay = `${url}\n${text}`.toLowerCase();
  for (const sig of BLOCK_SIGNALS) {
    if (hay.includes(sig)) return sig;
  }
  return null;
}

function sha256(s: string): string {
  return createHash("sha256").update(s || "", "utf8").digest("hex");
}

/** Capture screenshot + DOM evidence best-effort (never throws). */
async function collectEvidence(page: Page, want: boolean): Promise<{ screenshotBase64?: string; domHtml?: string }> {
  if (!want) return {};
  const out: { screenshotBase64?: string; domHtml?: string } = {};
  try {
    const buf = await page.screenshot({ type: "png", fullPage: false });
    out.screenshotBase64 = buf.toString("base64");
  } catch {
    /* screenshot optional */
  }
  try {
    out.domHtml = (await page.content()).slice(0, 2_000_000);
  } catch {
    /* dom optional */
  }
  return out;
}

function buildResult(
  answer: string,
  hrefs: string[],
  evidence: { screenshotBase64?: string; domHtml?: string },
  opts: CaptureOptions
): RawCapture {
  const persona = opts.persona === "mobile" ? "mobile" : "desktop";
  return {
    answer,
    citedUrls: externalLinks(hrefs),
    responseHash: sha256(answer),
    screenshotBase64: evidence.screenshotBase64,
    domHtml: evidence.domHtml,
    context: { geo: opts.geo, locale: opts.locale || localeForGeo(opts.geo), timezone: opts.timezone, persona },
  };
}

async function capturePerplexity(ctx: BrowserContext, prompt: string, opts: CaptureOptions): Promise<CaptureOutcome> {
  const page = await ctx.newPage();
  try {
    await page.goto(`https://www.perplexity.ai/search?q=${encodeURIComponent(prompt)}`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    await page.waitForSelector("main", { timeout: NAV_TIMEOUT });
    await page.waitForTimeout(6000);
    const answer = (await page.locator("main").innerText().catch(() => "")) || "";
    const blocked = detectBlock(page.url(), answer);
    if (blocked) return { blocked: true, reason: blocked };
    const hrefs = await page.locator("a").evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href).filter(Boolean)
    );
    if (!answer.trim()) return null;
    return buildResult(answer, hrefs, await collectEvidence(page, opts.withEvidence !== false), opts);
  } finally {
    await page.close().catch(() => {});
  }
}

async function captureGoogleAiOverview(ctx: BrowserContext, prompt: string, opts: CaptureOptions): Promise<CaptureOutcome> {
  const page = await ctx.newPage();
  try {
    const gl = opts.geo ? `&gl=${encodeURIComponent(opts.geo.toLowerCase())}` : "";
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(prompt)}${gl}`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    await page.waitForTimeout(5000);
    const candidates = ["[data-attrid='AIOverview']", "div[jsname][data-mcpr]", "#rso"];
    let answer = "";
    for (const sel of candidates) {
      const loc = page.locator(sel).first();
      if (await loc.count().catch(() => 0)) {
        answer = (await loc.innerText().catch(() => "")) || "";
        if (answer.trim()) break;
      }
    }
    const blocked = detectBlock(page.url(), answer || (await page.title().catch(() => "")));
    if (blocked) return { blocked: true, reason: blocked };
    const hrefs = await page.locator("a").evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href).filter(Boolean)
    );
    if (!answer.trim()) return null;
    return buildResult(answer, hrefs, await collectEvidence(page, opts.withEvidence !== false), opts);
  } finally {
    await page.close().catch(() => {});
  }
}

async function captureBingCopilot(ctx: BrowserContext, prompt: string, opts: CaptureOptions): Promise<CaptureOutcome> {
  const page = await ctx.newPage();
  try {
    // Bing's "Copilot answers" render inline on the SERP for many queries (keyless).
    await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(prompt)}`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    await page.waitForTimeout(5000);
    const candidates = ["#b_results", "[class*='b_ans']", "main"];
    let answer = "";
    for (const sel of candidates) {
      const loc = page.locator(sel).first();
      if (await loc.count().catch(() => 0)) {
        answer = (await loc.innerText().catch(() => "")) || "";
        if (answer.trim()) break;
      }
    }
    const blocked = detectBlock(page.url(), answer || (await page.title().catch(() => "")));
    if (blocked) return { blocked: true, reason: blocked };
    const hrefs = await page.locator("a").evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href).filter(Boolean)
    );
    if (!answer.trim()) return null;
    return buildResult(answer, hrefs, await collectEvidence(page, opts.withEvidence !== false), opts);
  } finally {
    await page.close().catch(() => {});
  }
}

async function captureAuthedChat(
  ctx: BrowserContext,
  surface: "chatgpt" | "gemini",
  prompt: string,
  opts: CaptureOptions
): Promise<CaptureOutcome> {
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
    const blocked = detectBlock(page.url(), answer);
    if (blocked) return { blocked: true, reason: blocked };
    const hrefs = await page.locator("main a").evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href).filter(Boolean)
    );
    if (!answer.trim()) return null;
    return buildResult(answer, hrefs, await collectEvidence(page, opts.withEvidence !== false), opts);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function capture(surface: Surface, prompt: string, opts: CaptureOptions = {}): Promise<CaptureOutcome> {
  const browser = await getBrowser();
  const ctx = await newContext(browser, opts);
  try {
    if (surface === "perplexity") return await capturePerplexity(ctx, prompt, opts);
    if (surface === "google_ai_overview") return await captureGoogleAiOverview(ctx, prompt, opts);
    if (surface === "bing_copilot") return await captureBingCopilot(ctx, prompt, opts);
    return await captureAuthedChat(ctx, surface, prompt, opts);
  } catch {
    return null;
  } finally {
    await ctx.close().catch(() => {});
  }
}
