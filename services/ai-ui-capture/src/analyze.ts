/**
 * Pure analysis helpers for a captured AI answer. Kept browser-free so they can
 * be unit-tested without launching Chromium. The capture layer supplies the
 * visible answer text + any cited link hrefs; these functions derive the
 * brand/competitor signals and normalized source domains.
 */

export interface CaptureAnalysis {
  brandMentioned: boolean;
  brandCited: boolean;
  competitorMentions: Record<string, boolean>;
  sourceDomains: string[];
  citedUrls: string[];
  answer: string;
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Registrable-domain-ish comparison: same eTLD+1 by last two labels. */
export function sameRegistrableDomain(a: string, b: string): boolean {
  const norm = (d: string) => d.replace(/^www\./, "").toLowerCase().split(".").slice(-2).join(".");
  const na = norm(a.includes("://") ? hostnameOf(a) : a);
  const nb = norm(b.includes("://") ? hostnameOf(b) : b);
  return Boolean(na) && na === nb;
}

/** Loose, accent-insensitive whole-token-ish mention test. */
export function isMentioned(text: string, term: string): boolean {
  if (!term) return false;
  const haystack = text.toLowerCase();
  const needle = term.toLowerCase().replace(/^www\./, "").replace(/\.(com|io|net|org|co|ai|app)$/i, "");
  if (needle.length < 2) return false;
  return haystack.includes(needle);
}

export function analyzeCapture(
  answer: string,
  citedUrls: string[],
  brandName: string,
  brandDomain: string,
  competitors: string[]
): CaptureAnalysis {
  const cleanUrls = [...new Set(citedUrls.filter(Boolean))];
  const sourceDomains = [...new Set(cleanUrls.map(hostnameOf).filter(Boolean))];

  const brandToken = brandDomain.replace(/^www\./, "").split(".")[0];
  const brandMentioned = isMentioned(answer, brandName) || isMentioned(answer, brandToken);
  const brandCited = sourceDomains.some((d) => sameRegistrableDomain(d, brandDomain));

  const competitorMentions: Record<string, boolean> = {};
  for (const c of competitors) competitorMentions[c] = isMentioned(answer, c);

  return {
    brandMentioned,
    brandCited,
    competitorMentions,
    sourceDomains,
    citedUrls: cleanUrls,
    answer,
  };
}
