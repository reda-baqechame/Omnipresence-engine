import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiForbidden, apiNotFound, apiUnauthorized } from "@/lib/security/api-response";
import { buildEntityProfile, generateSameAsJsonLd } from "@/lib/engines/entity-engine";
import { checkNapConsistency } from "@/lib/engines/nap-checker";
import type { BrandProfile, Project } from "@/types/database";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const checkNap = request.nextUrl.searchParams.get("checkNap");
  if (checkNap === "1") {
    const { data: project } = await supabase.from("projects").select("domain, name").eq("id", projectId).single();
    const { data: brand } = await supabase.from("brand_profiles").select("*").eq("project_id", projectId).single();
    if (!project?.domain) return NextResponse.json({ findings: [] });

    const canonical = {
      name: brand?.brand_name || project.name,
      address: undefined as string | undefined,
      phone: undefined as string | undefined,
    };

    let homepageHtml = "";
    try {
      const res = await fetch(`https://${project.domain.replace(/^https?:\/\//, "")}`, {
        signal: AbortSignal.timeout(10000),
      });
      homepageHtml = await res.text();
    } catch {
      return NextResponse.json({ findings: [], error: "Could not fetch homepage" });
    }

    const findings = checkNapConsistency(canonical, [
      { url: `https://${project.domain}`, html: homepageHtml },
    ]);
    return NextResponse.json({ findings, canonical });
  }

  const { data } = await supabase.from("entity_profiles").select("*").eq("project_id", projectId).single();
  return NextResponse.json({ profile: data });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId } = await request.json();
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase.from("projects").select("*").eq("id", projectId).single();
  if (!project) return apiNotFound();

  const { data: brand } = await supabase.from("brand_profiles").select("*").eq("project_id", projectId).single();

  const built = await buildEntityProfile(project as Project, (brand || {}) as BrandProfile);

  await supabase.from("entity_profiles").upsert(
    { ...built.profile, updated_at: new Date().toISOString() },
    { onConflict: "project_id" }
  );

  return NextResponse.json({
    profile: built.profile,
    wikidataDraft: built.wikidataDraft,
    napIssues: built.napIssues,
    sameAsJsonLd: generateSameAsJsonLd(built.profile.same_as_map || {}),
  });
}
