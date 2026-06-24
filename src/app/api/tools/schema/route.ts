import { NextRequest, NextResponse } from "next/server";
import { scrapePage } from "@/lib/providers/firecrawl";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { apiError } from "@/lib/security/api-response";

const RECOMMENDED = ["Organization", "LocalBusiness", "WebSite", "FAQPage", "Product", "Service"];

export async function POST(request: NextRequest) {
  const limited = guardPublicEndpoint(request, "tools-schema", 10, 60 * 60 * 1000);
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

  if (!result.success || !result.data) {
    return apiError("Could not fetch page");
  }

  const schemaTypes = result.data.schemaTypes;
  const missing = RECOMMENDED.filter((t) => !schemaTypes.includes(t));

  return NextResponse.json({
    domain: normalized,
    schemaTypes,
    missing,
    hasTitle: !!result.data.title,
    hasMetaDescription: !!result.data.metaDescription,
    wordCount: result.data.wordCount,
  });
}
