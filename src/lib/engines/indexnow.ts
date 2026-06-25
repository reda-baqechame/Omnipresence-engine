import { assertPublicDomain } from "@/lib/security/domain";

export async function submitIndexNow(urls: string[], siteHost: string): Promise<number> {
  const key = process.env.INDEXNOW_KEY;
  if (!key || !urls.length) return 0;

  const host = siteHost.replace(/^https?:\/\//, "").split("/")[0];
  let submitted = 0;

  for (const url of urls.slice(0, 20)) {
    try {
      assertPublicDomain(new URL(url).hostname);
      const res = await fetch("https://api.indexnow.org/indexnow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, key, urlList: [url] }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) submitted++;
    } catch {
      // skip invalid URL
    }
  }

  return submitted;
}
