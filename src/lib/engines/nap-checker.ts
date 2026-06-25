/** NAP (Name, Address, Phone) consistency across site pages and brand profile. */

export interface NapProfile {
  name: string;
  address?: string;
  phone?: string;
}

export interface NapFinding {
  field: "name" | "address" | "phone";
  expected: string;
  found?: string;
  url?: string;
  severity: "high" | "medium";
}

export function extractNapFromHtml(html: string): Partial<NapProfile> {
  const phone = html.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)?.[0];
  const addressMatch = html.match(
    /\d{1,5}\s+[\w\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln)[^<]{0,80}/i
  );
  return {
    phone: phone?.trim(),
    address: addressMatch?.[0]?.trim(),
  };
}

export function checkNapConsistency(
  canonical: NapProfile,
  pages: Array<{ url: string; html: string }>
): NapFinding[] {
  const findings: NapFinding[] = [];

  for (const page of pages) {
    const extracted = extractNapFromHtml(page.html);
    if (canonical.phone && extracted.phone && !normalizePhone(extracted.phone).includes(normalizePhone(canonical.phone).slice(-7))) {
      findings.push({
        field: "phone",
        expected: canonical.phone,
        found: extracted.phone,
        url: page.url,
        severity: "high",
      });
    }
    if (canonical.name && page.html && !page.html.toLowerCase().includes(canonical.name.toLowerCase().slice(0, 8))) {
      findings.push({
        field: "name",
        expected: canonical.name,
        url: page.url,
        severity: "medium",
      });
    }
  }

  return findings.slice(0, 15);
}

function normalizePhone(p: string): string {
  return p.replace(/\D/g, "");
}
