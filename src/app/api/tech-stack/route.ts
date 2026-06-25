import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { detectTechStack } from "@/lib/engines/tech-detect";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";

/**
 * Competitor technology-stack detection (MIT webappanalyzer fingerprints).
 * Pass ?domain= to inspect a specific competitor; defaults to the project
 * domain. SSRF-guarded via assertPublicDomain.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("domain, competitors")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const requested = request.nextUrl.searchParams.get("domain") || project.domain;

  // Only allow the project domain or a listed competitor — prevents using the
  // authenticated endpoint as an open SSRF/scraping proxy.
  const allowedDomains = new Set(
    [project.domain, ...((project.competitors || []) as string[])].map((d) => {
      try {
        return assertPublicDomain(d);
      } catch {
        return "";
      }
    }).filter(Boolean)
  );

  let domain: string;
  try {
    domain = assertPublicDomain(requested);
  } catch (e) {
    if (e instanceof DomainValidationError) return apiError(e.message);
    throw e;
  }

  if (!allowedDomains.has(domain)) {
    return apiError("Domain must be the project domain or a listed competitor", 403);
  }

  try {
    const result = await detectTechStack(domain);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Tech detection failed",
      502
    );
  }
}
