import { NextRequest, NextResponse } from "next/server";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { apiError } from "@/lib/security/api-response";

export async function POST(request: NextRequest) {
  const limited = guardPublicEndpoint(request, "tools-canonical", 15, 60 * 60 * 1000);
  if (limited) return limited;

  const { domain, path } = await request.json();
  if (!domain) return apiError("Domain required");

  let normalized: string;
  try {
    normalized = assertPublicDomain(domain);
  } catch (error) {
    if (error instanceof DomainValidationError) return apiError(error.message);
    return apiError("Invalid domain");
  }

  const pagePath = path ? String(path).replace(/^\//, "") : "";
  const url = `https://${normalized}/${pagePath}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: "follow" });
    const html = await res.text();
    const match = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
    const hrefMatch = match?.[0].match(/href=["']([^"']+)["']/i);
    const canonical = hrefMatch?.[1] || null;
    const selfCanonical = canonical === url || canonical === url.replace(/\/$/, "");

    return NextResponse.json({
      domain: normalized,
      url,
      canonical,
      selfCanonical,
      status: res.status,
      issue: !canonical ? "missing" : selfCanonical ? "ok" : "mismatch",
    });
  } catch {
    return apiError("Could not fetch page");
  }
}
