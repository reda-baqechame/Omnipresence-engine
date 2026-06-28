import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiServerError, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId, siteId, apiKey } = await readJsonBody(request);
  if (!projectId || !siteId) {
    return apiError("projectId and siteId required");
  }

  const access = await verifyProjectAccess(supabase, projectId, user.id, "admin");
  if (!access) return apiForbidden();

  if (!apiKey?.trim()) {
    return apiError("Plausible API key required");
  }

  const { error } = await supabase.from("oauth_connections").upsert(
    {
      project_id: projectId,
      provider: "plausible",
      access_token: String(apiKey).slice(0, 256),
      metadata: { site_id: String(siteId).slice(0, 120) },
    },
    { onConflict: "project_id,provider" }
  );

  if (error) return apiServerError("plausible connect failed", error);
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "admin");
  if (!access) return apiForbidden();

  await supabase
    .from("oauth_connections")
    .delete()
    .eq("project_id", projectId)
    .eq("provider", "plausible");

  return NextResponse.json({ success: true });
}
