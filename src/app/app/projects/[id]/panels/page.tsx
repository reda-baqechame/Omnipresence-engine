import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { PanelManager } from "@/components/panel-manager";

export default async function PanelsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const { data: panels } = await supabase
    .from("ai_prompt_panels")
    .select("id, name, description, geos, personas, engines, runs_per_prompt, is_active, last_run_at, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  const ids = (panels || []).map((p) => p.id);
  const counts: Record<string, number> = {};
  if (ids.length) {
    const { data: members } = await supabase
      .from("ai_prompt_panel_members")
      .select("panel_id")
      .in("panel_id", ids);
    for (const m of members || []) counts[m.panel_id] = (counts[m.panel_id] || 0) + 1;
  }

  const withCounts = (panels || []).map((p) => ({ ...p, member_count: counts[p.id] || 0 }));

  return (
    <div className="space-y-6 p-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Prompt Panels</h1>
        <p className="text-muted-foreground">
          Curated prompt clusters measured repeatedly across engines, geos, and personas — with sample-size gating and confidence intervals.
        </p>
      </div>
      <PanelManager projectId={id} panels={withCounts} />
    </div>
  );
}
