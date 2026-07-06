import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { GenerateReportForm } from "@/components/generate-report-form";
import { canUseDeepReport } from "@/lib/plans/features";
import type { SubscriptionPlan } from "@/types/database";

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
  const plan = (memberships?.[0]?.organizations as { plan?: SubscriptionPlan } | null)?.plan;

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

      {reports && reports.length > 0 ? (
        <div className="space-y-3">
          {reports.map((report) => (
            <div
              key={report.id}
              className="bg-card border border-border rounded-xl p-4 flex items-center justify-between"
            >
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  {report.title}
                  {report.report_type === "deep" && (
                    <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                      Deep
                    </span>
                  )}
                  {(report.status === "generating" || report.status === "pending") && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                      Generating…
                    </span>
                  )}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {(report.projects as { name: string; domain: string })?.name} ·{" "}
                  {new Date(report.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex gap-2">
                {report.status === "ready" && (
                  <>
                    <a
                      href={`/api/report/${report.share_token}/pdf`}
                      className="text-sm text-primary hover:underline flex items-center gap-1"
                    >
                      PDF <ExternalLink className="h-3 w-3" />
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
              </div>
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
