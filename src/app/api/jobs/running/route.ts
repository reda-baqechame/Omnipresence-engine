import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiUnauthorized } from "@/lib/security/api-response";

export interface RunningReportJob {
  kind: "report";
  id: string;
  projectId: string;
  projectName: string | null;
  title: string;
  status: string;
  reportType: string | null;
  currentStep: string | null;
  progressPercent: number | null;
  shareToken: string;
  createdAt: string;
}

export interface RunningScanJob {
  kind: "scan";
  id: string;
  projectId: string;
  projectName: string | null;
  status: string;
  currentStep: string | null;
  progressPercent: number | null;
  startedAt: string | null;
}

export type RunningJob = RunningReportJob | RunningScanJob;

/**
 * Every in-flight report/scan the signed-in user can see, across every
 * project they belong to — the global "nothing expensive runs invisibly"
 * surface. Uses the RLS-scoped session client only (no service role), so
 * results are automatically limited to the user's own organizations.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const [{ data: reports }, { data: runs }] = await Promise.all([
    supabase
      .from("reports")
      .select(
        "id, project_id, title, status, report_type, current_step, progress_percent, share_token, created_at, projects(name)"
      )
      .in("status", ["pending", "generating", "cancelling"])
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("visibility_runs")
      .select("id, project_id, status, current_step, progress_percent, started_at, projects(name)")
      .in("status", ["pending", "running", "cancelling"])
      .order("started_at", { ascending: false })
      .limit(20),
  ]);

  const reportJobs: RunningReportJob[] = (reports || []).map((r) => ({
    kind: "report",
    id: r.id,
    projectId: r.project_id,
    projectName: (r.projects as { name?: string } | null)?.name ?? null,
    title: r.title,
    status: r.status,
    reportType: r.report_type,
    currentStep: r.current_step,
    progressPercent: r.progress_percent,
    shareToken: r.share_token,
    createdAt: r.created_at,
  }));

  const scanJobs: RunningScanJob[] = (runs || []).map((r) => ({
    kind: "scan",
    id: r.id,
    projectId: r.project_id,
    projectName: (r.projects as { name?: string } | null)?.name ?? null,
    status: r.status,
    currentStep: r.current_step,
    progressPercent: r.progress_percent,
    startedAt: r.started_at,
  }));

  return NextResponse.json({ jobs: [...reportJobs, ...scanJobs] });
}
