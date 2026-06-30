/**
 * Best-effort tech-stack detection (SimilarWeb/BuiltWith "tech tracker" lite).
 *
 * Uses open, rule-based fingerprints matched against a page's HTML, response
 * headers, cookies and script sources. Keyless and free. Results are labeled
 * "best-effort fingerprint" -- they detect what a page exposes publicly, not a
 * guaranteed full inventory. Prefers OmniData's endpoint when deployed.
 */
import { isOmniDataActive, labsApiPost } from "@/lib/providers/dataforseo";
import { detectFromResponse, type TechStackResult } from "@/lib/engines/tech-stack-fingerprint";

export { detectFromResponse } from "@/lib/engines/tech-stack-fingerprint";
export type { DetectedTech, TechStackResult } from "@/lib/engines/tech-stack-fingerprint";

async function detectDirect(url: string): Promise<TechStackResult> {
  const target = url.startsWith("http") ? url : `https://${url}`;
  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OmniPresenceTech/1.0)",
        connection: "close",
      },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    const html = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    const cookies = res.headers.get("set-cookie") || "";
    return detectFromResponse(res.url || target, html, headers, cookies);
  } catch {
    return { url: target, technologies: [], categories: {}, data_source: "fingerprint", available: false };
  }
}

export async function detectTechStack(url: string): Promise<TechStackResult> {
  if (isOmniDataActive()) {
    const res = await labsApiPost<{ tasks: Array<{ result: Array<TechStackResult> }> }>(
      "/tech/detect",
      [{ url }]
    );
    const data = res?.tasks?.[0]?.result?.[0];
    if (data && data.available) return data;
  }
  return detectDirect(url);
}
