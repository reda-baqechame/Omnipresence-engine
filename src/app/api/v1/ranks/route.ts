import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateApiKey } from "@/lib/security/api-keys";
import { guardApiKeyEndpoint } from "@/lib/security/api-v1-guard";

/**
 * Public API (Phase 11): read rank data for a project owned by the API key's org.
 * Auth via `x-api-key` or `Authorization: Bearer omp_...`.
 */
export async function GET(request: NextRequest) {
  const supabase = await createServiceClient();
  const ctx = await authenticateApiKey(supabase, request);
  if (!ctx) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }

  const limited = await guardApiKeyEndpoint(request, ctx.organizationId, "ranks", 120, 60 * 60 * 1000);
  if (limited) return limited;

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  // Scope: project must belong to the key's organization.
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, domain")
    .eq("id", projectId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Project not found for this key" }, { status: 404 });
  }

  const { data: keywords } = await supabase
    .from("rank_keywords")
    .select("keyword, location, device, last_position, is_striking_distance, share_of_voice, brand_in_ai_overview, last_serp_features, last_checked_at")
    .eq("project_id", projectId)
    .order("last_position", { ascending: true, nullsFirst: false })
    .limit(1000);

  return NextResponse.json({
    project: { id: project.id, name: project.name, domain: project.domain },
    keywords: keywords || [],
  });
}
