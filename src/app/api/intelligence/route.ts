import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calculateAeoMetrics, compareAeoRuns } from "@/lib/engines/aeo-metrics";
import type { VisibilityResult } from "@/types/database";
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

  const { data: project } = await supabase
    .from("projects")
    .select("name, competitors")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const [{ data: visibility }, { data: runs }, { data: gaps }, { data: keywords }] =
    await Promise.all([
      supabase.from("visibility_results").select("*").eq("project_id", projectId),
      supabase
        .from("visibility_runs")
        .select("id, completed_at, created_at, status")
        .eq("project_id", projectId)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(2),
      supabase
        .from("content_gap_findings")
        .select("*")
        .eq("project_id", projectId)
        .order("opportunity_score", { ascending: false })
        .limit(20),
      supabase
        .from("keyword_opportunities")
        .select("keyword, opportunity_score, difficulty, our_position")
        .eq("project_id", projectId)
        .order("opportunity_score", { ascending: false })
        .limit(10),
    ]);

  const results = (visibility || []) as VisibilityResult[];
  const aeo = calculateAeoMetrics(results, project.name, project.competitors || []);

  let runComparison = null;
  if (runs && runs.length >= 2) {
    const current = results.filter((r) => r.run_id === runs[0].id);
    const previous = results.filter((r) => r.run_id === runs[1].id);
    if (current.length && previous.length) {
      runComparison = compareAeoRuns(current, previous, project.name, project.competitors || []);
    }
  }

  return NextResponse.json({
    aeo,
    runComparison,
    topKeywords: keywords || [],
    contentGaps: gaps || [],
    dataQuality: {
      measuredRate: aeo.measuredRate,
      totalProbes: aeo.totalProbes,
      live: aeo.measuredRate > 0.5,
    },
  });
}
