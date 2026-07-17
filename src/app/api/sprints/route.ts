import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiUnauthorized, apiServerError, validateBody } from "@/lib/security/api-response";
import { SprintCreateSchema } from "@/lib/validation/schemas";
import { buildSprintItems, sprintWeekStart } from "@/lib/engines/action-sprint";

/** GET /api/sprints?projectId= — sprint history, newest first. */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();
  const access = await verifyProjectAccess(supabase, projectId, user.id);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("action_sprints")
    .select("*")
    .eq("project_id", projectId)
    .order("week_start", { ascending: false })
    .limit(26);
  if (error) return apiServerError("sprint list failed", error);
  return NextResponse.json({ sprints: data || [] });
}

/** POST /api/sprints — propose this week's sprint (idempotent per week). */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(req, SprintCreateSchema);
  if (parsed.response) return parsed.response;

  const access = await verifyProjectAccess(supabase, parsed.data.projectId, user.id, "member");
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const weekStart = sprintWeekStart();
  const { data: existing } = await supabase
    .from("action_sprints")
    .select("*")
    .eq("project_id", parsed.data.projectId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (existing) return NextResponse.json({ sprint: existing });

  const { data: project } = await supabase
    .from("projects")
    .select("domain")
    .eq("id", parsed.data.projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const items = await buildSprintItems(supabase, parsed.data.projectId, project.domain);
  if (items.length === 0) {
    return apiError("No measured gaps to build a sprint from — run a scan first.", 409);
  }

  const { data: sprint, error } = await supabase
    .from("action_sprints")
    .insert({
      project_id: parsed.data.projectId,
      organization_id: access.organizationId,
      week_start: weekStart,
      status: "proposed",
      items,
    })
    .select()
    .single();
  if (error) return apiServerError("sprint create failed", error);
  return NextResponse.json({ sprint });
}
