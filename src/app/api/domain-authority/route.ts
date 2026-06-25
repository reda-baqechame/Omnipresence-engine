import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDomainAuthority } from "@/lib/providers/tranco";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";

/**
 * Domain authority signal from the Tranco popularity ranking (permissive,
 * commercial-friendly). Returns the project domain plus any competitor domains
 * for side-by-side comparison.
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

  const targets = [project.domain, ...((project.competitors || []) as string[])];
  const valid: string[] = [];
  for (const t of targets) {
    try {
      valid.push(assertPublicDomain(t));
    } catch (e) {
      if (!(e instanceof DomainValidationError)) throw e;
      // skip malformed competitor entries
    }
  }

  const results = await Promise.all(valid.map((d) => getDomainAuthority(d)));
  const authorities = results
    .filter((r) => r.success && r.data)
    .map((r) => r.data!);

  return NextResponse.json({
    brand: authorities.find((a) => a.domain === assertPublicDomain(project.domain)) || null,
    domains: authorities,
  });
}
