import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Plus, ArrowRight } from "lucide-react";
import { ScoreGauge } from "@/components/score-gauge";
import { OrgSetupBanner } from "@/components/org-setup-banner";

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
    .limit(10);

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

      <h2 className="text-xl font-semibold mb-4">Recent Projects</h2>
      {projects && projects.length > 0 ? (
        <div className="space-y-3">
          {projects.map((project) => {
            const latestScore = (project.scores as Array<{ omnipresence_score: number }>)?.[0]?.omnipresence_score;
            return (
              <Link key={project.id} href={`/app/projects/${project.id}`}
                className="flex items-center justify-between bg-card border border-border rounded-xl p-4 hover:border-primary/50 transition">
                <div>
                  <h3 className="font-semibold">{project.name}</h3>
                  <p className="text-sm text-muted-foreground">{project.domain} · {project.status}</p>
                </div>
                <div className="flex items-center gap-4">
                  {latestScore !== undefined && (
                    <div className="text-2xl font-bold text-primary">{Math.round(latestScore)}</div>
                  )}
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            );
          })}
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
