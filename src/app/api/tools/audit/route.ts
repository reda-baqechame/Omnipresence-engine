import { NextRequest, NextResponse } from "next/server";
import { runTechnicalAudit } from "@/lib/engines/technical-audit";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { apiError, readJsonBody } from "@/lib/security/api-response";

export async function POST(request: NextRequest) {
  const limited = await guardPublicEndpoint(request, "tools-audit", 10, 60 * 60 * 1000);
  if (limited) return limited;

  let domain: string | undefined;
  try {
    ({ domain } = await readJsonBody(request));
  } catch {
    return apiError("Invalid JSON body");
  }
  if (!domain) return apiError("Domain required");

  try {
    const normalized = assertPublicDomain(domain);
    const findings = await runTechnicalAudit(normalized);
    return NextResponse.json({ findings });
  } catch (error) {
    if (error instanceof DomainValidationError) return apiError(error.message);
    return apiError("Audit failed");
  }
}
