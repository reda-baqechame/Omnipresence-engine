import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Plus } from "lucide-react";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: memberships } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user!.id);

  const orgIds = memberships?.map((m) => m.organization_id) || [];

  const { data: projects } = await supabase
    .from("projects")
    .select("*, scores(omnipresence_score)")
    .in("organization_id", orgIds)
    .order("updated_at", { ascending: false });

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Projects</h1>
        <Link href="/app/projects/new" className="bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium flex items-center gap-2">
          <Plus className="h-4 w-4" /> New Project
        </Link>
      </div>

      <div className="space-y-3">
        {projects?.map((project) => {
          const score = (project.scores as Array<{ omnipresence_score: number }>)?.[0]?.omnipresence_score;
          return (
            <Link key={project.id} href={`/app/projects/${project.id}`}
              className="flex items-center justify-between bg-card border border-border rounded-xl p-4 hover:border-primary/50 transition">
              <div>
                <h3 className="font-semibold">{project.name}</h3>
                <p className="text-sm text-muted-foreground">{project.domain} · {project.industry} · {project.status}</p>
              </div>
              {score !== undefined && <div className="text-2xl font-bold text-primary">{Math.round(score)}</div>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
