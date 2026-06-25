/** Visitor identity — optional Clearbit Reveal enrichment from IP. */

const CLEARBIT_KEY = process.env.CLEARBIT_REVEAL_KEY;

export interface VisitorEnrichment {
  companyName?: string;
  companyDomain?: string;
  industry?: string;
  enriched: boolean;
}

export async function enrichVisitorFromIp(ip: string): Promise<VisitorEnrichment> {
  if (!CLEARBIT_KEY || !ip || ip === "127.0.0.1" || ip.startsWith("::")) {
    return { enriched: false };
  }

  try {
    const res = await fetch(`https://reveal.clearbit.com/v1/companies/find?ip=${encodeURIComponent(ip)}`, {
      headers: { Authorization: `Bearer ${CLEARBIT_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { enriched: false };
    const data = (await res.json()) as {
      company?: { name?: string; domain?: string; category?: { industry?: string } };
    };
    if (!data.company?.name) return { enriched: false };
    return {
      companyName: data.company.name,
      companyDomain: data.company.domain,
      industry: data.company.category?.industry,
      enriched: true,
    };
  } catch {
    return { enriched: false };
  }
}
