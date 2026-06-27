import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiForbidden, apiUnauthorized } from "@/lib/security/api-response";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { getLedgerForProject, buildGuaranteeReport, calculatePeriodCitationDelta } from "@/lib/engines/results-ledger";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const entries = await getLedgerForProject(supabase, projectId);

  const { data: scores } = await supabase
    .from("scores")
    .select("omnipresence_score, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(2);

  const { data: metrics } = await supabase
    .from("attribution_metrics")
    .select("organic_traffic, ai_referral_traffic")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(2);

  const { count: citationCount } = await supabase
    .from("citation_sources")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("cites_brand", true);

  const { data: baselines } = await supabase
    .from("results_ledger")
    .select("baseline_snapshot")
    .eq("project_id", projectId)
    .eq("action_type", "scan_baseline")
    .order("executed_at", { ascending: false })
    .limit(2);

  const prevCitations = Number(
    (baselines?.[1]?.baseline_snapshot as { citation_count?: number } | null)?.citation_count ??
    (baselines?.[0]?.baseline_snapshot as { citation_count?: number } | null)?.citation_count ??
    0
  );
  const citationDelta = calculatePeriodCitationDelta(citationCount ?? 0, prevCitations);

  const report = buildGuaranteeReport(
    entries,
    {
      before: scores?.[1]?.omnipresence_score ?? 0,
      after: scores?.[0]?.omnipresence_score ?? 0,
    },
    {
      before: metrics?.[1]?.organic_traffic ?? 0,
      after: metrics?.[0]?.organic_traffic ?? 0,
    },
    {
      before: citationDelta.before,
      after: citationDelta.after,
    }
  );

  return NextResponse.json({ entries, guaranteeReport: report, citationDelta });
}
