import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { runDueRankSchedules, ensureDefaultRankSchedule, syncScheduleKeywords } from "@/lib/engines/rank-schedule-service";
import { runAllRankChecks } from "@/lib/engines/rank-tracker-service";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const [{ data: schedules }, { data: runs }, { data: keywordRows }] = await Promise.all([
    supabase.from("rank_schedules").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
    supabase
      .from("rank_schedule_runs")
      .select("id, status, started_at, completed_at, result_summary")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("rank_schedule_keywords")
      .select("id, keyword, is_active")
      .eq("project_id", projectId)
      .eq("is_active", true),
  ]);

  return NextResponse.json({
    schedules: schedules || [],
    runs: runs || [],
    keywordCount: keywordRows?.length || 0,
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await readJsonBody(req);
  const { projectId, cadence, action } = body as {
    projectId: string;
    cadence?: "daily" | "weekly";
    action?: "ensure" | "run_now";
  };
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  if (action === "run_now") {
    const { data: project } = await supabase.from("projects").select("domain").eq("id", projectId).single();
    const results = await runAllRankChecks(supabase, projectId, project?.domain || "");
    return NextResponse.json({ keywordsChecked: results.length, message: `Checked ${results.length} keywords` });
  }

  const c = cadence === "daily" ? "daily" : "weekly";
  const next = new Date();
  if (c === "weekly") next.setDate(next.getDate() + 7);
  else next.setDate(next.getDate() + 1);

  const { error } = await supabase.from("rank_schedules").upsert(
    {
      project_id: projectId,
      organization_id: access.organizationId,
      name: "default",
      cadence: c,
      is_active: true,
      next_run_at: next.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id,name" }
  );
  if (error) return apiError(error.message, 500);

  const { data: sched } = await supabase
    .from("rank_schedules")
    .select("id")
    .eq("project_id", projectId)
    .eq("name", "default")
    .maybeSingle();
  if (sched?.id) await syncScheduleKeywords(supabase, sched.id, projectId);

  await runDueRankSchedules(supabase).catch(() => 0);

  return NextResponse.json({ ok: true, message: `${c} rank schedule active` });
}
