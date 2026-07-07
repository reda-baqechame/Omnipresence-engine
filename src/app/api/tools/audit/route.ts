import { NextRequest, NextResponse } from "next/server";
import { runTechnicalAudit } from "@/lib/engines/technical-audit";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { apiError, validateBody } from "@/lib/security/api-response";
import { ToolsDomainSchema } from "@/lib/validation/schemas";

export async function POST(request: NextRequest) {
  const limited = await guardPublicEndpoint(request, "tools-audit", 10, 60 * 60 * 1000);
  if (limited) return limited;

  const v = await validateBody(request, ToolsDomainSchema);
  if (v.response) return v.response;
  const { domain } = v.data;

  try {
    const normalized = assertPublicDomain(domain);
    const findings = await runTechnicalAudit(normalized);
    return NextResponse.json({ findings });
  } catch (error) {
    if (error instanceof DomainValidationError) return apiError(error.message);
    return apiError("Audit failed");
  }
}
