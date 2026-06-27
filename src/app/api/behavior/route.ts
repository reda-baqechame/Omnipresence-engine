import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";
import { runBehaviorAnalytics } from "@/lib/engines/behavior-analytics";
import { hasClarityCapability } from "@/lib/providers/clarity";
import { loadProjectIntegration } from "@/lib/integrations/store";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const integration = await loadProjectIntegration<{ token?: string }>(supabase, projectId, "clarity");
  const connected = hasClarityCapability(integration?.token);

  const { data } = await supabase
    .from("behavior_metrics")
    .select("url, sessions, scroll_depth_pct, engagement_time_sec, dead_clicks, rage_clicks, quickbacks, data_source, captured_at")
    .eq("project_id", projectId)
    .order("sessions", { ascending: false })
    .limit(200);

  return NextResponse.json({ connected, metrics: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  let body: { projectId?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }
  const { projectId } = body;
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const summary = await runBehaviorAnalytics(supabase, {
    projectId,
    organizationId: project.organization_id,
  });

  return NextResponse.json(summary);
}
