import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { ProjectIdSchema } from "@/lib/validation/schemas";
import { getFastestPath, syncFastestPathTasks } from "@/lib/engines/fastest-path-service";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const result = await getFastestPath(supabase, projectId);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(request, ProjectIdSchema);
  if (parsed.response) return parsed.response;
  const { projectId } = parsed.data;

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project?.organization_id) return apiError("project organization not found");

  const result = await syncFastestPathTasks(supabase, projectId, project.organization_id as string);
  return NextResponse.json(result);
}
