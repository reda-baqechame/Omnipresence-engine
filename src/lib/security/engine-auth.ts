import { createHmac } from "crypto";

export function signOmniDataRequest(body: unknown): Record<string, string> {
  const secret = process.env.OMNIDATA_SIGNING_SECRET || process.env.OMNIDATA_API_KEY;
  if (!secret) return {};

  const timestamp = String(Date.now());
  const payload = JSON.stringify(body);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return {
    "x-omnidata-timestamp": timestamp,
    "x-omnidata-signature": signature,
  };
}

export function getOmniDataHeaders(body: unknown): Record<string, string> {
  const key = process.env.OMNIDATA_API_KEY;
  if (!key) return {};
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...signOmniDataRequest(body),
  };
}

export async function crawlViaOmniData(
  url: string,
  maxPages = 25
): Promise<{
  pages: Array<{ url: string; status: number; title?: string; pagerank: number; simhash: string }>;
  duplicate_clusters: Array<{ simhash: string; urls: string[] }>;
} | null> {
  const base = process.env.OMNIDATA_BASE_URL?.replace(/\/$/, "");
  if (!base) return null;

  const body = [{ url, max_pages: maxPages }];
  const res = await fetch(`${base}/v3/on_page/crawl`, {
    method: "POST",
    headers: getOmniDataHeaders(body),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as {
    tasks?: Array<{ result?: Array<{ pages?: unknown[]; duplicate_clusters?: unknown[] }> }>;
  };
  const result = data.tasks?.[0]?.result?.[0];
  if (!result) return null;
  return result as {
    pages: Array<{ url: string; status: number; title?: string; pagerank: number; simhash: string }>;
    duplicate_clusters: Array<{ simhash: string; urls: string[] }>;
  };
}
