import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Plus, ArrowRight } from "lucide-react";
import { ScoreGauge } from "@/components/score-gauge";
import { OrgSetupBanner } from "@/components/org-setup-banner";
import { daysSince } from "@/lib/time";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: memberships } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user!.id)
    .limit(1);

  if (!memberships || memberships.length === 0) {
    return (
      <div>
        <h1 className="text-3xl font-bold mb-8">Welcome to PresenceOS</h1>
        <OrgSetupBanner />
      </div>
    );
  }

  const orgIds = memberships?.map((m) => m.organization_id) || [];

  const { data: projects } = await supabase
    .from("projects")
    .select("*, scores(omnipresence_score, created_at)")
    .in("organization_id", orgIds)
    .order("updated_at", { ascending: false })
    .limit(50);

  const projectIds = (projects || []).map((p) => p.id);
  const { data: openTaskRows } = projectIds.length
    ? await supabase
        .from("execution_tasks")
        .select("project_id, status")
        .in("project_id", projectIds)
    : { data: [] as Array<{ project_id: string; status: string }> };

  const openTasksByProject = new Map<string, number>();
  for (const t of openTaskRows || []) {
    if (t.status === "done" || t.status === "completed") continue;
    openTasksByProject.set(t.project_id, (openTasksByProject.get(t.project_id) || 0) + 1);
  }

  function clientHealth(p: { updated_at: string; scores?: Array<{ omnipresence_score: number }> }): {
    label: string;
    tone: string;
  } {
    const score = p.scores?.[0]?.omnipresence_score ?? 0;
    const staleDays = daysSince(p.updated_at);
    if (staleDays > 30) return { label: "Stale — needs scan", tone: "text-amber-400" };
    if (score > 0 && score < 40) return { label: "At risk", tone: "text-red-400" };
    if (score >= 70) return { label: "Healthy", tone: "text-green-400" };
    return { label: "Building", tone: "text-cyan-400" };
  }

  const activeProjects = projects?.filter((p) => p.status === "active" || p.status === "scanning") || [];
  const avgScore = activeProjects.length > 0
    ? activeProjects.reduce((sum, p) => {
        const latestScore = (p.scores as Array<{ omnipresence_score: number }>)?.[0]?.omnipresence_score || 0;
        return sum + latestScore;
      }, 0) / activeProjects.length
    : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Your organic visibility command center</p>
        </div>
        <Link href="/app/projects/new" className="bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium flex items-center gap-2 hover:opacity-90 transition">
          <Plus className="h-4 w-4" /> New Project
        </Link>
      </div>

      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="text-sm text-muted-foreground">Projects</div>
          <div className="text-3xl font-bold mt-1">{projects?.length || 0}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="text-sm text-muted-foreground">Active Scans</div>
          <div className="text-3xl font-bold mt-1">{activeProjects.length}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-6">
          <ScoreGauge score={avgScore} label="Avg OmniPresence Score" size="sm" />
        </div>
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="text-sm text-muted-foreground">Access</div>
          <div className="text-lg font-bold mt-1 text-primary">Full — Free</div>
          <p className="text-xs text-muted-foreground mt-1">All features unlocked</p>
        </div>
      </div>

      <h2 className="text-xl font-semibold mb-4">Client portfolio</h2>
      {projects && projects.length > 0 ? (
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50">
              <tr>
                <th className="text-left p-3">Client</th>
                <th className="text-left p-3">Health</th>
                <th className="text-left p-3">Score</th>
                <th className="text-left p-3">Open actions</th>
                <th className="text-left p-3">Last activity</th>
                <th className="text-left p-3"></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const latestScore = (project.scores as Array<{ omnipresence_score: number }>)?.[0]?.omnipresence_score;
                const health = clientHealth(project as { updated_at: string; scores?: Array<{ omnipresence_score: number }> });
                const openCount = openTasksByProject.get(project.id) || 0;
                return (
                  <tr key={project.id} className="border-t border-border">
                    <td className="p-3">
                      <Link href={`/app/projects/${project.id}`} className="font-medium hover:text-primary">
                        {project.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{project.domain}</div>
                    </td>
                    <td className={`p-3 font-medium ${health.tone}`}>{health.label}</td>
                    <td className="p-3 font-bold text-primary">
                      {latestScore !== undefined ? Math.round(latestScore) : "—"}
                    </td>
                    <td className="p-3 text-muted-foreground">{openCount}</td>
                    <td className="p-3 text-muted-foreground text-xs">
                      {new Date(project.updated_at).toLocaleDateString()}
                    </td>
                    <td className="p-3">
                      <Link href={`/app/projects/${project.id}/war-room`} className="text-primary text-xs inline-flex items-center gap-1">
                        War Room <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-muted-foreground mb-4">No projects yet. Create your first OmniPresence audit.</p>
          <Link href="/app/projects/new" className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium inline-flex items-center gap-2">
            <Plus className="h-4 w-4" /> Create First Project
          </Link>
        </div>
      )}
    </div>
  );
}
