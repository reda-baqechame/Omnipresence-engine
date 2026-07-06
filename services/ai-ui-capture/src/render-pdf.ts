import { chromium, type Browser } from "playwright";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browser;
}

export interface RenderPdfOptions {
  html: string;
  timeoutMs?: number;
}

export async function renderHtmlToPdf(opts: RenderPdfOptions): Promise<Buffer> {
  const b = await getBrowser();
  const page = await b.newPage();
  const timeout = opts.timeoutMs ?? 60_000;

  try {
    await page.setContent(opts.html, { waitUntil: "networkidle", timeout });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function closePdfBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
