import robotsParser from "robots-parser";

const CRAWLER_UA = "PresenceOS-Crawler/1.0";

export async function loadRobotsForDomain(domain: string): Promise<ReturnType<typeof robotsParser> | null> {
  const base = domain.startsWith("http") ? domain : `https://${domain}`;
  const origin = new URL(base).origin;
  const robotsUrl = `${origin}/robots.txt`;

  try {
    const res = await fetch(robotsUrl, {
      headers: { "User-Agent": CRAWLER_UA },
      signal: AbortSignal.timeout(8000),
    });
    const text = res.ok ? await res.text() : "";
    return robotsParser(robotsUrl, text);
  } catch {
    return null;
  }
}

export async function isCrawlAllowed(url: string, domain: string): Promise<boolean> {
  const robots = await loadRobotsForDomain(domain);
  if (!robots) return true;
  return robots.isAllowed(url, CRAWLER_UA) !== false;
}

export { CRAWLER_UA };
