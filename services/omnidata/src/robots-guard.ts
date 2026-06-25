const CRAWLER_UA = "OmniData-Crawler/1.0";
const cache = new Map<string, { rules: string[]; expires: number }>();

async function loadDisallowRules(domain: string): Promise<string[]> {
  const key = domain.replace(/^www\./, "").toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.rules;

  const origin = `https://${key}`;
  let rules: string[] = [];
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": CRAWLER_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const text = await res.text();
      let inWildcard = false;
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const lower = trimmed.toLowerCase();
        if (lower.startsWith("user-agent:")) {
          const ua = trimmed.split(":")[1]?.trim().toLowerCase() || "";
          inWildcard = ua === "*" || ua.includes("omnidata");
          continue;
        }
        if (inWildcard && lower.startsWith("disallow:")) {
          const path = trimmed.split(":").slice(1).join(":").trim();
          if (path) rules.push(path);
        }
      }
    }
  } catch {
    // allow crawl when robots unavailable
  }

  cache.set(key, { rules, expires: Date.now() + 3600_000 });
  return rules;
}

function pathBlocked(pathname: string, rules: string[]): boolean {
  for (const rule of rules) {
    if (rule === "/") return true;
    if (pathname.startsWith(rule)) return true;
  }
  return false;
}

export async function isCrawlAllowed(url: string, domain: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const rules = await loadDisallowRules(domain);
    if (!rules.length) return true;
    return !pathBlocked(parsed.pathname, rules);
  } catch {
    return false;
  }
}

export { CRAWLER_UA };
