import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { GenerateReportForm } from "@/components/generate-report-form";
import { ReportVisibilityToggle } from "@/components/report-visibility-toggle";
import { canUseDeepReport } from "@/lib/plans/features";
import { formatJobCost, formatTokenCount } from "@/lib/utils";
import { groupReportVersions } from "@/lib/reports/version-grouping";
import type { Report, SubscriptionPlan } from "@/types/database";

type ReportRow = Report & {
  projects?: { name: string; domain: string } | null;
};

/**
 * Real attributed spend for a report, honest about coverage gaps: `actual_cost`
 * only accumulates for provider calls that ran inside a job-context scope
 * (migration 0078's increment_report_usage rollup) — omit entirely rather
 * than show a misleading "$0.00" for a report with zero tracked spend.
 */
function reportCostLabel(report: {
  actual_cost?: number | string;
  tokens_used?: number | string;
}): string | null {
  // NUMERIC columns come back as strings from PostgREST — coerce, matching
  // the existing est_cost_usd handling in cost-guard.ts/external-api-guard.ts.
  const cost = Number(report.actual_cost) || 0;
  const tokens = Number(report.tokens_used) || 0;
  if (cost <= 0 && tokens <= 0) return null;
  const costStr = formatJobCost(cost);
  return tokens > 0 ? `${costStr} · ${formatTokenCount(tokens)}` : costStr;
}

export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: memberships } = await supabase
    .from("memberships")
    .select("organization_id, organizations(plan)")
    .eq("user_id", user!.id);

  const orgIds = memberships?.map((m) => m.organization_id) || [];
  const plan = (
    memberships?.[0]?.organizations as { plan?: SubscriptionPlan } | null
  )?.plan;

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, domain")
    .in("organization_id", orgIds);

  const projectIds = projects?.map((p) => p.id) || [];

  const { data: reports } = await supabase
    .from("reports")
    .select("*, projects(name, domain)")
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });

  const firstProject = projects?.[0];
  const reportGroups = groupReportVersions(
    (reports as ReportRow[] | null) || [],
  );

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Reports</h1>

      {firstProject && (
        <div className="mb-8">
          <GenerateReportForm
            projectId={firstProject.id}
            canDeepReport={canUseDeepReport(plan)}
          />
        </div>
      )}

      {reportGroups.length > 0 ? (
        <div className="space-y-3">
          {reportGroups.map(({ latest: report, ancestors }) => (
            <div
              key={report.id}
              className="bg-card border border-border rounded-xl p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold flex items-center gap-2">
                    {report.title}
                    {typeof report.version === "number" &&
                      report.version > 1 && (
                        <span
                          className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full"
                          title={`Version ${report.version} — supersedes ${ancestors.length} earlier ${ancestors.length === 1 ? "version" : "versions"}`}
                        >
                          v{report.version}
                        </span>
                      )}
                    {report.report_type === "deep" && (
                      <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                        Deep
                      </span>
                    )}
                    {(report.status === "generating" ||
                      report.status === "pending") && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                        Generating…
                      </span>
                    )}
                    {report.status === "cancelling" && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                        Stopping…
                      </span>
                    )}
                    {report.status === "cancelled" && (
                      <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">
                        Cancelled
                      </span>
                    )}
                    {report.status === "failed" && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                        Failed
                      </span>
                    )}
                    {report.status === "ready" && report.pdf_degraded && (
                      <span
                        className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full"
                        title="PDF renderer was unavailable when this report was generated — the download link serves the HTML artifact instead."
                      >
                        HTML only
                      </span>
                    )}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {
                      (report.projects as { name: string; domain: string })
                        ?.name
                    }{" "}
                    · {new Date(report.created_at).toLocaleDateString()}
                    {reportCostLabel(report) && (
                      <> · {reportCostLabel(report)}</>
                    )}
                  </p>
                  {report.status === "failed" && report.error_message && (
                    <p className="text-sm text-red-600 mt-1">
                      {report.error_message}
                    </p>
                  )}
                  {report.status === "cancelled" && report.error_message && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {report.error_message}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {report.status === "ready" && (
                    <>
                      <a
                        href={`/api/report/${report.share_token}/pdf`}
                        className="text-sm text-primary hover:underline flex items-center gap-1"
                      >
                        {report.pdf_degraded ? "HTML" : "PDF"}{" "}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <Link
                        href={`/portal/${report.share_token}`}
                        className="text-sm text-muted-foreground hover:underline"
                      >
                        Portal
                      </Link>
                    </>
                  )}
                  <Link
                    href={`/report/${report.share_token}`}
                    className="text-sm text-muted-foreground hover:underline"
                  >
                    Share
                  </Link>
                  <ReportVisibilityToggle
                    projectId={report.project_id}
                    reportId={report.id}
                    initialIsPublic={report.is_public}
                  />
                </div>
              </div>
              {ancestors.length > 0 && (
                <details className="mt-3 border-t border-border pt-3">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    {ancestors.length} earlier{" "}
                    {ancestors.length === 1 ? "version" : "versions"}
                  </summary>
                  <div className="mt-2 space-y-2">
                    {ancestors.map((prev) => (
                      <div
                        key={prev.id}
                        className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2 text-sm"
                      >
                        <div>
                          <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full mr-2">
                            v{prev.version ?? 1}
                          </span>
                          <span className="text-muted-foreground">
                            {new Date(prev.created_at).toLocaleDateString()}
                            {reportCostLabel(prev) && (
                              <> · {reportCostLabel(prev)}</>
                            )}
                          </span>
                        </div>
                        {prev.status === "ready" && (
                          <a
                            href={`/api/report/${prev.share_token}/pdf`}
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                          >
                            {prev.pdf_degraded ? "HTML" : "PDF"}{" "}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">
          No reports yet. Generate your first report above.
        </p>
      )}
    </div>
  );
}
