/**
 * Shared brand / competitor matching.
 *
 * Why this exists: detection across the codebase used naive `String.includes`,
 * which produces both false positives ("apple" matches "pineapple.com", domain
 * token "go" matches any sentence with the word "go") and false negatives (no
 * aliases, no eTLD+1 domain comparison). An expert dismisses a tool the moment a
 * mention/citation is wrong, so all visibility/citation detection should route
 * through this module: word-boundary text matching + registrable-domain
 * (eTLD+1) comparison + explicit alias support.
 */

// Pragmatic multi-part public suffixes (covers the vast majority of real cases
// without bundling the full Public Suffix List).
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk",
  "com.au", "net.au", "org.au", "gov.au", "edu.au",
  "co.nz", "co.za", "co.jp", "or.jp", "ne.jp",
  "com.br", "com.mx", "com.ar", "com.tr", "com.cn",
  "com.sg", "com.hk", "com.tw", "co.in", "co.id", "co.kr",
  "com.my", "com.ph", "com.vn", "co.il", "com.sa", "com.ua",
]);

/** Lowercase hostname without protocol / www / path. */
export function normalizeHost(input: string): string {
  if (!input) return "";
  let host = input.trim().toLowerCase();
  if (host.includes("://") || host.includes("/")) {
    try {
      host = new URL(host.includes("://") ? host : `https://${host}`).hostname;
    } catch {
      host = host.replace(/^https?:\/\//, "").split("/")[0];
    }
  }
  return host.replace(/^www\./, "");
}

/** Registrable domain (eTLD+1), e.g. "a.b.stripe.co.uk" -> "stripe.co.uk". */
export function registrableDomain(input: string): string {
  const host = normalizeHost(input);
  if (!host || !host.includes(".")) return host;
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

/** True when two hosts share the same registrable domain. */
export function sameRegistrableDomain(a: string, b: string): boolean {
  const ra = registrableDomain(a);
  const rb = registrableDomain(b);
  return ra.length > 0 && ra === rb;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary, case-insensitive presence of `term` in `text`. Uses
 * non-alphanumeric boundaries so "go" does not match "google" and "AT&T" works.
 */
export function mentionsTerm(text: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (t.length < 2) return false;
  const lower = text.toLowerCase();
  const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(t)}(?![a-z0-9])`);
  return re.test(lower);
}

export interface MatcherInput {
  name: string;
  domain?: string;
  /** Extra aliases: legal name, product names, common misspellings. */
  aliases?: string[];
}

export class EntityMatcher {
  readonly name: string;
  readonly registrable: string;
  /** Distinct prose terms to match in answer/snippet text (word-boundary). */
  readonly terms: string[];

  constructor(input: MatcherInput) {
    this.name = input.name;
    this.registrable = input.domain ? registrableDomain(input.domain) : "";

    const terms = new Set<string>();
    const add = (v?: string) => {
      const t = (v || "").trim();
      if (t.length >= 2) terms.add(t.toLowerCase());
    };
    add(input.name);
    for (const a of input.aliases || []) add(a);
    // The domain's registrable root (e.g. "stripe") is a strong alias, but only
    // when it's a meaningful token (>= 4 chars) to avoid generic short tokens.
    if (this.registrable) {
      const root = this.registrable.split(".")[0];
      if (root.length >= 4 && root !== "www") add(root);
    }
    this.terms = [...terms];
  }

  /** Brand/competitor named in prose (word-boundary, alias-aware). */
  mentionedIn(text: string): boolean {
    if (!text) return false;
    return this.terms.some((t) => mentionsTerm(text, t));
  }

  /** Cited via a list of source domains (eTLD+1 comparison, not substring). */
  citedInDomains(domains: string[]): boolean {
    if (!this.registrable) return false;
    return domains.some((d) => sameRegistrableDomain(d, this.registrable));
  }

  /** Cited via a list of full URLs. */
  citedInUrls(urls: string[]): boolean {
    if (!this.registrable) return false;
    return urls.some((u) => sameRegistrableDomain(u, this.registrable));
  }
}

export function makeBrandMatcher(name: string, domain: string, aliases?: string[]): EntityMatcher {
  return new EntityMatcher({ name, domain, aliases });
}

/**
 * Competitor strings may be names ("Acme Corp") or domains ("acme.com"). Build a
 * matcher that uses domain comparison when a dot is present, and always supports
 * name-in-prose matching.
 */
export function makeCompetitorMatcher(competitor: string): EntityMatcher {
  const looksLikeDomain = /\.[a-z]{2,}$/i.test(competitor.trim());
  return new EntityMatcher(
    looksLikeDomain
      ? { name: competitor.replace(/\.[a-z.]+$/i, ""), domain: competitor }
      : { name: competitor }
  );
}
