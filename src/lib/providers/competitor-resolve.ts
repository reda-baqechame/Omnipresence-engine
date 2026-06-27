import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Resolve a competitor name to its official domain via SERP (free/cheap stack). */
export async function resolveCompetitorDomainFree(
  competitor: string,
  industry: string
): Promise<string | null> {
  const query = `${competitor} ${industry} official website`.trim();
  const res = await searchGoogleOrganicRouter(query, "United States", "", []);

  if (!res.success || !res.data?.organicResults.length) {
    return null;
  }

  const first = res.data.organicResults[0];
  const domain = hostnameFromUrl(first.url);
  return domain || null;
}

export interface ResolvedCompetitor {
  name: string;
  /** null when SERP could not confidently resolve a domain — we NEVER guess name+".com". */
  domain: string | null;
  source: "serp" | "unresolved";
  /** 0-1 confidence the domain is correct. */
  confidence: number;
  evidence_url?: string;
}

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve a competitor name to its domain with a confidence score and evidence.
 * Confidence is derived from how strongly the resolved domain matches the brand
 * name and where it appears in the SERP. Unresolved competitors are returned
 * with domain=null so callers can flag them instead of fabricating a domain.
 */
export async function resolveCompetitorWithConfidence(
  competitor: string,
  industry: string
): Promise<ResolvedCompetitor> {
  const query = `${competitor} ${industry} official website`.trim();
  const res = await searchGoogleOrganicRouter(query, "United States", "", []);

  if (!res.success || !res.data?.organicResults.length) {
    return { name: competitor, domain: null, source: "unresolved", confidence: 0 };
  }

  const token = normalizeToken(competitor);
  const results = res.data.organicResults.slice(0, 5);

  const aggregatorHosts = new Set([
    "facebook.com", "linkedin.com", "instagram.com", "twitter.com", "x.com",
    "youtube.com", "wikipedia.org", "yelp.com", "g2.com", "capterra.com",
    "trustpilot.com", "crunchbase.com", "glassdoor.com", "indeed.com",
  ]);

  for (let i = 0; i < results.length; i++) {
    const host = hostnameFromUrl(results[i].url);
    if (!host || aggregatorHosts.has(host)) continue;
    const hostToken = normalizeToken(host.split(".")[0]);
    const nameMatch = token.length > 2 && (hostToken.includes(token) || token.includes(hostToken));
    if (i === 0 && nameMatch) {
      return { name: competitor, domain: host, source: "serp", confidence: 0.9, evidence_url: results[i].url };
    }
    if (nameMatch) {
      return { name: competitor, domain: host, source: "serp", confidence: 0.7, evidence_url: results[i].url };
    }
    if (i === 0) {
      // First non-aggregator result but no name match — plausible, lower confidence.
      return { name: competitor, domain: host, source: "serp", confidence: 0.5, evidence_url: results[i].url };
    }
  }

  return { name: competitor, domain: null, source: "unresolved", confidence: 0 };
}

/** Resolve a list of competitors with confidence (best-effort, sequential to respect rate limits). */
export async function resolveCompetitorList(
  competitors: string[],
  industry: string,
  max = 5
): Promise<ResolvedCompetitor[]> {
  const out: ResolvedCompetitor[] = [];
  for (const c of competitors.slice(0, max)) {
    out.push(await resolveCompetitorWithConfidence(c, industry).catch(() => ({
      name: c,
      domain: null,
      source: "unresolved" as const,
      confidence: 0,
    })));
  }
  return out;
}
