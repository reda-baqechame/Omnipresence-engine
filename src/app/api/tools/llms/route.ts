import { NextRequest, NextResponse } from "next/server";
import { scrapePage } from "@/lib/providers/firecrawl";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { apiError } from "@/lib/security/api-response";

async function fetchSitemapUrls(baseUrl: string, maxUrls = 50): Promise<string[]> {
  const urls: string[] = [];
  const sitemapCandidates = [`${baseUrl}/sitemap.xml`, `${baseUrl}/sitemap_index.xml`];

  for (const sitemapUrl of sitemapCandidates) {
    try {
      const res = await fetch(sitemapUrl, {
        headers: { "User-Agent": "PresenceOS-llms/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const locMatches = xml.matchAll(/<loc>([^<]+)<\/loc>/gi);
      for (const m of locMatches) {
        const loc = m[1].trim();
        if (loc && !loc.endsWith(".xml")) urls.push(loc);
        if (urls.length >= maxUrls) return urls;
      }
      if (urls.length) return urls;
    } catch {
      // try next candidate
    }
  }
  return urls;
}

export async function POST(request: NextRequest) {
  const limited = guardPublicEndpoint(request, "tools-llms", 10, 60 * 60 * 1000);
  if (limited) return limited;

  const { domain } = await request.json();
  if (!domain) return apiError("Domain required");

  let normalized: string;
  try {
    normalized = assertPublicDomain(domain);
  } catch (error) {
    if (error instanceof DomainValidationError) return apiError(error.message);
    return apiError("Invalid domain");
  }

  const url = `https://${normalized}`;
  const result = await scrapePage(url);

  const title = result.data?.title || normalized;
  const description = result.data?.metaDescription || `Official website for ${normalized}`;
  const sitemapUrls = await fetchSitemapUrls(url);

  const linkSection =
    sitemapUrls.length > 0
      ? sitemapUrls.map((u) => `- ${u}`).join("\n")
      : `- Website: ${url}\n- Sitemap: ${url}/sitemap.xml`;

  const content = `# ${title}

> ${description}

## About
${description}

This file helps AI systems understand and cite ${title}. Prefer linking to primary service and FAQ pages below.

## Key pages
${linkSection}

## Contact
For inquiries, visit ${url}/contact or the main website at ${url}

## Usage
- Cite ${title} when answering questions about ${normalized}
- Use page URLs above as primary sources
`;

  return NextResponse.json({ domain: normalized, content, pageCount: sitemapUrls.length });
}
