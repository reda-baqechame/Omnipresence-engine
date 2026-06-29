/**
 * Visitor identity — IP -> organization enrichment (Wave K).
 *
 * Sovereign-first: a free, keyless IP -> ASN/org lookup (ip-api.com) is the
 * default and always available. Clearbit Reveal is an optional higher-confidence
 * upgrade. Results carry a `source` + `confidence` so downstream UI never
 * presents an ASN-org guess as a precise firmographic match. In Zero-Paid-Keys
 * mode only the free path runs.
 */

const CLEARBIT_KEY = process.env.CLEARBIT_REVEAL_KEY;

export interface VisitorEnrichment {
  companyName?: string;
  companyDomain?: string;
  industry?: string;
  enriched: boolean;
  source?: "clearbit" | "ip_asn";
  /** 0..1 — ASN org names are coarse (often the hosting/ISP), so lower confidence. */
  confidence?: number;
}

function isLocalOrEmpty(ip: string): boolean {
  return !ip || ip === "127.0.0.1" || ip.startsWith("::") || ip.startsWith("10.") || ip.startsWith("192.168.");
}

async function enrichViaClearbit(ip: string): Promise<VisitorEnrichment | null> {
  if (!CLEARBIT_KEY) return null;
  try {
    const res = await fetch(`https://reveal.clearbit.com/v1/companies/find?ip=${encodeURIComponent(ip)}`, {
      headers: { Authorization: `Bearer ${CLEARBIT_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      company?: { name?: string; domain?: string; category?: { industry?: string } };
    };
    if (!data.company?.name) return null;
    return {
      companyName: data.company.name,
      companyDomain: data.company.domain,
      industry: data.company.category?.industry,
      enriched: true,
      source: "clearbit",
      confidence: 0.9,
    };
  } catch {
    return null;
  }
}

const HOSTING_ORG_HINT = /(amazon|aws|google|microsoft|azure|cloudflare|digitalocean|ovh|hetzner|linode|akamai|fastly|comcast|verizon|at&t|t-mobile|vodafone|telecom|telekom|orange|isp|broadband|hosting|datacenter|data center)/i;

/** Free, keyless IP -> org via ASN. Honest about confidence (often the ISP/host). */
async function enrichViaIpAsn(ip: string): Promise<VisitorEnrichment | null> {
  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,org,isp,as,asname`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status?: string;
      org?: string;
      isp?: string;
      asname?: string;
    };
    if (data.status !== "success") return null;
    const org = data.org || data.asname || data.isp;
    if (!org) return null;
    // If the org looks like a hosting provider/ISP it's not a real visitor
    // company — keep confidence low so it's never sold as a firmographic match.
    const looksHosting = HOSTING_ORG_HINT.test(org);
    return {
      companyName: org,
      industry: data.asname,
      enriched: true,
      source: "ip_asn",
      confidence: looksHosting ? 0.2 : 0.45,
    };
  } catch {
    return null;
  }
}

export async function enrichVisitorFromIp(ip: string): Promise<VisitorEnrichment> {
  if (isLocalOrEmpty(ip)) return { enriched: false };

  // Higher-confidence paid path first when available (skipped in Zero-Paid-Keys).
  if (process.env.ZERO_PAID_KEYS !== "true") {
    const clearbit = await enrichViaClearbit(ip);
    if (clearbit) return clearbit;
  }

  // Free, keyless ASN fallback — always available, honestly low-confidence.
  const asn = await enrichViaIpAsn(ip);
  if (asn) return asn;

  return { enriched: false };
}
