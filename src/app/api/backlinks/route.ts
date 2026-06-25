import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  snapshotProjectBacklinks,
  getLatestBacklinkDiff,
} from "@/lib/engines/backlink-monitor";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const diff = await getLatestBacklinkDiff(supabase, projectId);
  const { data: latest } = await supabase
    .from("backlink_snapshots")
    .select("total_count, new_count, lost_count, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ latest, diff });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId } = await request.json() as { projectId: string };
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("domain")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const result = await snapshotProjectBacklinks(supabase, projectId, project.domain);
  return NextResponse.json(result);
}
