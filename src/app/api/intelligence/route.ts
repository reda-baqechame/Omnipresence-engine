import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calculateAeoMetrics, compareAeoRuns } from "@/lib/engines/aeo-metrics";
import {
  loadProjectVisibilitySnapshot,
  groundedVisibilityResults,
} from "@/lib/engines/visibility-scope";
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

  const [{ data: gaps }, { data: keywords }, visibility] = await Promise.all([
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
    loadProjectVisibilitySnapshot(supabase, projectId, project.name, project.competitors || []),
  ]);

  const { groundedResults, allResults, runs } = visibility;
  const aeo = calculateAeoMetrics(groundedResults, project.name, project.competitors || []);

  let runComparison = null;
  const completed = runs.filter((r) => r.status === "completed");
  if (completed.length >= 2) {
    const current = allResults.filter((r) => r.run_id === completed[0].id);
    const previous = allResults.filter((r) => r.run_id === completed[1].id);
    if (current.length && previous.length) {
      runComparison = compareAeoRuns(
        groundedVisibilityResults(current),
        groundedVisibilityResults(previous),
        project.name,
        project.competitors || []
      );
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
      groundedProbes: groundedResults.length,
      live: groundedResults.length >= 10,
    },
  });
}
