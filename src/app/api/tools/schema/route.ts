import { NextRequest, NextResponse } from "next/server";
import { scrapePage } from "@/lib/providers/firecrawl";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { apiError, validateBody } from "@/lib/security/api-response";
import { ToolsDomainSchema } from "@/lib/validation/schemas";

const RECOMMENDED = ["Organization", "LocalBusiness", "WebSite", "FAQPage", "Product", "Service"];

async function extractSchemaTypesFromHtml(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "OmniPresence-SchemaTool/1.0" } });
    if (!res.ok) return [];
    const html = await res.text();
    const types = new Set<string>();
    for (const m of html.matchAll(/"@type"\s*:\s*"([^"]+)"/g)) types.add(m[1]);
    for (const m of html.matchAll(/"@type"\s*:\s*\[([^\]]+)\]/g)) {
      for (const t of m[1].matchAll(/"([^"]+)"/g)) types.add(t[1]);
    }
    return [...types];
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest) {
  const limited = await guardPublicEndpoint(request, "tools-schema", 10, 60 * 60 * 1000);
  if (limited) return limited;

  const v = await validateBody(request, ToolsDomainSchema);
  if (v.response) return v.response;
  const { domain } = v.data;

  let normalized: string;
  try {
    normalized = assertPublicDomain(domain);
  } catch (error) {
    if (error instanceof DomainValidationError) return apiError(error.message);
    return apiError("Invalid domain");
  }

  const url = `https://${normalized}`;
  const result = await scrapePage(url);
  const scraped = result.success && result.data ? result.data : null;

  const schemaTypes =
    scraped?.schemaTypes?.length
      ? scraped.schemaTypes
      : await extractSchemaTypesFromHtml(url);

  if (!scraped && schemaTypes.length === 0) {
    return apiError("Could not fetch page");
  }

  const missing = RECOMMENDED.filter((t) => !schemaTypes.includes(t));

  return NextResponse.json({
    domain: normalized,
    schemaTypes,
    missing,
    hasTitle: !!scraped?.title,
    hasMetaDescription: !!scraped?.metaDescription,
    wordCount: scraped?.wordCount ?? null,
    source: scraped?.schemaTypes?.length ? "firecrawl" : "html_fallback",
  });
}
