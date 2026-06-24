import { NextRequest, NextResponse } from "next/server";
import { scrapePage } from "@/lib/providers/firecrawl";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { apiError } from "@/lib/security/api-response";

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

  const content = `# ${title}

> ${description}

## About
${normalized} provides professional services. Visit our website for more information.

## Links
- Website: ${url}
- Sitemap: ${url}/sitemap.xml

## Contact
For inquiries, visit ${url}/contact
`;

  return NextResponse.json({ domain: normalized, content });
}
