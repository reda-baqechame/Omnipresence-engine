import { assertPublicDomain } from "@/lib/security/domain";
import { submitIndexNow } from "@/lib/engines/indexnow";

export interface IndexSubmission {
  url: string;
  engine: "indexnow" | "bing";
  status: "submitted" | "failed" | "skipped";
  submitted_at: string;
}

export function parseUrlCsv(csv: string): string[] {
  return csv
    .split(/[\n,]/)
    .map((u) => u.trim())
    .filter((u) => u.startsWith("http"));
}

export async function submitBingUrl(url: string, siteUrl: string): Promise<boolean> {
  const key = process.env.BING_INDEXNOW_KEY || process.env.INDEXNOW_KEY;
  if (!key) return false;
  try {
    assertPublicDomain(new URL(url).hostname);
    const host = new URL(siteUrl).hostname.replace(/^www\./, "");
    const res = await fetch(`https://www.bing.com/indexnow?url=${encodeURIComponent(url)}&key=${key}&host=${host}`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });
    return res.ok || res.status === 202;
  } catch {
    return false;
  }
}

export async function bulkSubmitUrls(
  urls: string[],
  siteHost: string,
  engines: Array<"indexnow" | "bing"> = ["indexnow", "bing"]
): Promise<IndexSubmission[]> {
  const results: IndexSubmission[] = [];
  const now = new Date().toISOString();

  for (const url of urls.slice(0, 100)) {
    if (engines.includes("indexnow")) {
      const n = await submitIndexNow([url], siteHost);
      results.push({
        url,
        engine: "indexnow",
        status: n > 0 ? "submitted" : "failed",
        submitted_at: now,
      });
    }
    if (engines.includes("bing")) {
      const ok = await submitBingUrl(url, `https://${siteHost}`);
      results.push({
        url,
        engine: "bing",
        status: ok ? "submitted" : "failed",
        submitted_at: now,
      });
    }
  }

  return results;
}
