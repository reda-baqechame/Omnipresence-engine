/**
 * Domain age signal (free, keyless). Older domains are a trust/authority proxy.
 *
 * - RDAP (rdap.org): registration date via the modern WHOIS replacement.
 * - Wayback CDX: earliest archived snapshot as a fallback "first seen".
 *
 * Returns { ageYears, firstSeen, source }. Never throws.
 */

export interface DomainAge {
  domain: string;
  firstSeen?: string;
  ageYears?: number;
  source: "rdap" | "wayback" | "unknown";
}

function cleanDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase()
    .trim();
}

function yearsSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.round(((Date.now() - then) / (365.25 * 24 * 60 * 60 * 1000)) * 10) / 10);
}

async function rdapRegistration(domain: string): Promise<string | null> {
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { Accept: "application/rdap+json", connection: "close" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      events?: Array<{ eventAction?: string; eventDate?: string }>;
    };
    const reg = data.events?.find((e) => e.eventAction === "registration");
    return reg?.eventDate || null;
  } catch {
    return null;
  }
}

async function waybackFirstSeen(domain: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
        domain
      )}&output=json&fl=timestamp&limit=1&sort=ascending`,
      { headers: { connection: "close" }, signal: AbortSignal.timeout(12_000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as string[][];
    // First row is the header ["timestamp"].
    const ts = data?.[1]?.[0];
    if (!ts || ts.length < 8) return null;
    return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
  } catch {
    return null;
  }
}

export async function getDomainAge(domain: string): Promise<DomainAge> {
  const clean = cleanDomain(domain);
  if (!clean) return { domain: clean, source: "unknown" };

  const rdap = await rdapRegistration(clean);
  if (rdap) {
    return { domain: clean, firstSeen: rdap, ageYears: yearsSince(rdap), source: "rdap" };
  }

  const wayback = await waybackFirstSeen(clean);
  if (wayback) {
    return { domain: clean, firstSeen: wayback, ageYears: yearsSince(wayback), source: "wayback" };
  }

  return { domain: clean, source: "unknown" };
}
