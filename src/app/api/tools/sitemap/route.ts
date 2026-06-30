import { NextRequest, NextResponse } from "next/server";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { apiError, readJsonBody } from "@/lib/security/api-response";

export async function POST(request: NextRequest) {
  const limited = await guardPublicEndpoint(request, "tools-sitemap", 15, 60 * 60 * 1000);
  if (limited) return limited;

  let domain: string | undefined;
  try {
    ({ domain } = await readJsonBody(request));
  } catch {
    return apiError("Invalid JSON body");
  }
  if (!domain) return apiError("Domain required");

  let normalized: string;
  try {
    normalized = assertPublicDomain(domain);
  } catch (error) {
    if (error instanceof DomainValidationError) return apiError(error.message);
    return apiError("Invalid domain");
  }

  const sitemapUrl = `https://${normalized}/sitemap.xml`;

  try {
    const res = await fetch(sitemapUrl, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      return NextResponse.json({
        domain: normalized,
        sitemapUrl,
        found: false,
        urlCount: 0,
        issues: ["sitemap.xml not reachable"],
      });
    }

    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1]);
    const issues: string[] = [];
    if (!locs.length) issues.push("No URLs found in sitemap");
    if (!xml.includes("<?xml")) issues.push("Missing XML declaration");

    return NextResponse.json({
      domain: normalized,
      sitemapUrl,
      found: true,
      urlCount: locs.length,
      sampleUrls: locs.slice(0, 10),
      issues,
    });
  } catch {
    return apiError("Could not fetch sitemap");
  }
}
