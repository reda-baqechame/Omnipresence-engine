import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { ExecutionTask, RoadmapItem } from "@/types/database";
import { getProject } from "@/lib/projects";
import { buildActionPlan } from "@/lib/engines/action-plan";
import { ActionPlanPanel } from "@/components/action-plan-panel";
import { ProjectHubPage } from "@/components/project-hub-page";

export default async function ActionProofHub({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const [{ data: tasks }, { data: roadmap }] = await Promise.all([
    supabase.from("execution_tasks").select("*").eq("project_id", id),
    supabase
      .from("roadmaps")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const actionPlan = buildActionPlan(id, (tasks || []) as ExecutionTask[]);
  const items = ((roadmap?.items || []) as RoadmapItem[]).slice(0, 6);

  const impactColor = {
    critical: "text-red-400 bg-red-500/10",
    high: "text-orange-400 bg-orange-500/10",
    medium: "text-yellow-400 bg-yellow-500/10",
    low: "text-blue-400 bg-blue-500/10",
  };

  return (
    <ProjectHubPage
      title="Action Plan & Proof"
      description="Prioritized work, execution tracking, evidence, reporting, attribution, and guarantee controls."
      projectId={id}
      tools={[
        { href: "/roadmap", title: "Evidence-linked roadmap", description: "Prioritized actions produced from measured findings and gaps.", status: "workflow" },
        { href: "/tasks", title: "Execution tasks", description: "Tracked tasks generated from scan findings and verified on re-scan.", status: "workflow" },
        { href: "/fastest-path", title: "Fastest path", description: "The smallest set of actions likely to move measured visibility fastest.", status: "workflow" },
        { href: "/war-room", title: "War room", description: "Operational view of urgent issues and active work.", status: "workflow" },
        { href: "/distribution", title: "Distribution", description: "Where completed content/actions should be distributed.", status: "workflow" },
        { href: "/proof", title: "Proof", description: "Evidence that claims and outputs were backed by measurements.", status: "measured" },
        { href: "/proof-ledger", title: "Proof ledger", description: "Tamper-evident ledger of claims, evidence, and verification artifacts.", status: "measured" },
        { href: "/roi", title: "ROI center", description: "Revenue and paid-ad-equivalent reporting only when attribution is connected.", status: "needs-setup" },
        { href: "/attribution", title: "Attribution", description: "Connect analytics and first-party conversion data.", status: "needs-setup" },
        { href: "/guarantee", title: "Guarantee controls", description: "Outcome guarantee checks and eligibility signals.", status: "workflow" },
        { href: "/operating", title: "Operating OS", description: "Recurring operating cadence and delivery management.", status: "workflow" },
      ]}
    >
      <ActionPlanPanel projectId={id} plan={actionPlan} />

      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Evidence-linked roadmap (preview)</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Top prioritized actions from measured findings — each item should cite the signal that produced it.
          </p>
        </div>
        <Link href={`/app/projects/${id}/roadmap`} className="text-sm text-primary hover:underline shrink-0">
          Full roadmap →
        </Link>
      </div>

      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h4 className="font-medium">{item.title}</h4>
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${impactColor[item.impact]}`}>{item.impact}</span>
                <span className="text-xs text-muted-foreground">Week {item.week}</span>
              </div>
              <p className="text-sm text-muted-foreground">{item.description}</p>
              {item.evidence_label && (
                <p className="text-xs text-primary mt-2">
                  Evidence: {item.evidence_url ? (
                    <a href={item.evidence_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {item.evidence_label}
                    </a>
                  ) : (
                    item.evidence_label
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          No roadmap yet. Run a scan to generate evidence-linked actions from measured gaps.
        </div>
      )}
    </ProjectHubPage>
  );
}
