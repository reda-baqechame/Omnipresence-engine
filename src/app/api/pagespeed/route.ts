import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzePageSpeed, type PageSpeedStrategy } from "@/lib/providers/pagespeed";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";

/**
 * Real Core Web Vitals + Lighthouse scores (Google PageSpeed Insights).
 * Measured data — safe to surface and to gate guarantees on.
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
    .select("domain")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  let domain: string;
  try {
    domain = assertPublicDomain(project.domain);
  } catch (e) {
    if (e instanceof DomainValidationError) return apiError(e.message);
    throw e;
  }

  const strategy = (request.nextUrl.searchParams.get("strategy") as PageSpeedStrategy) || "mobile";
  const result = await analyzePageSpeed(domain, strategy === "desktop" ? "desktop" : "mobile");

  if (!result.success) return apiError(result.error || "PageSpeed analysis failed", 502);
  return NextResponse.json(result.data);
}
