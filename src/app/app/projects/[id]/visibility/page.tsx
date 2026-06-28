import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { calculateVisibilityMetrics } from "@/lib/engines/visibility-scanner";
import { preferLiveData } from "@/lib/config/capabilities";
import { compareVisibilityRuns } from "@/lib/engines/visibility-delta";
import type { VisibilityResult } from "@/types/database";
import { getProject } from "@/lib/projects";
import { VisibilityTable } from "@/components/visibility-table";
import { ExportButtons } from "@/components/export-buttons";
import { CitationMovementPanel } from "@/components/citation-movement-panel";
import { PromptImportPanel } from "@/components/prompt-import-panel";
import { PromptHeatmap } from "@/components/prompt-heatmap";
import { AiTracesPanel } from "@/components/ai-traces-panel";
import type { PromptCategory } from "@/types/database";

export default async function VisibilityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();

  const [{ data: visibility }, { data: prompts }, { data: runs }] = await Promise.all([
    supabase.from("visibility_results").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("prompts").select("*").eq("project_id", id).order("priority", { ascending: false }),
    supabase.from("visibility_runs").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(5),
  ]);

  const results = (visibility || []) as VisibilityResult[];
  const metrics = calculateVisibilityMetrics(results);
  const liveMode = preferLiveData();

  const completedRuns = (runs || []).filter((r) => r.status === "completed");
  let runDelta = null;

  if (completedRuns.length >= 2) {
    const currentRun = completedRuns[0];
    const previousRun = completedRuns[1];
    const currentResults = results.filter((r) => r.run_id === currentRun.id);
    const previousResults = results.filter((r) => r.run_id === previousRun.id);

    if (currentResults.length > 0 && previousResults.length > 0) {
      runDelta = {
        ...compareVisibilityRuns(currentResults, previousResults, project.competitors || []),
        currentRunDate: currentRun.completed_at || currentRun.created_at,
        previousRunDate: previousRun.completed_at || previousRun.created_at,
      };
    }
  }

  const byEngine = results.reduce(
    (acc, r) => {
      if (!acc[r.engine]) acc[r.engine] = { total: 0, mentioned: 0, cited: 0 };
      acc[r.engine].total++;
      if (r.brand_mentioned) acc[r.engine].mentioned++;
      if (r.brand_cited) acc[r.engine].cited++;
      return acc;
    },
    {} as Record<string, { total: number; mentioned: number; cited: number }>
  );

  const heatmapCells = (() => {
    const promptMap = new Map((prompts || []).map((p) => [p.id, p.category as PromptCategory]));
    const byCat: Record<string, { total: number; mentioned: number; cited: number; prompts: number }> = {};
    for (const p of prompts || []) {
      if (!byCat[p.category]) byCat[p.category] = { total: 0, mentioned: 0, cited: 0, prompts: 0 };
      byCat[p.category].prompts++;
    }
    for (const r of results) {
      const cat = r.prompt_id ? promptMap.get(r.prompt_id) : null;
      if (!cat) continue;
      byCat[cat].total++;
      if (r.brand_mentioned) byCat[cat].mentioned++;
      if (r.brand_cited) byCat[cat].cited++;
    }
    return Object.entries(byCat).map(([category, stats]) => ({
      category: category as PromptCategory,
      prompts: stats.prompts,
      mentionRate: stats.total > 0 ? stats.mentioned / stats.total : 0,
      citationRate: stats.total > 0 ? stats.cited / stats.total : 0,
    }));
  })();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-3">
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${liveMode ? "bg-green-500/10 text-green-400 border border-green-500/30" : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30"}`}>
            {liveMode ? "Live DIY stack" : "Demo mode"}
          </span>
          <span className="text-muted-foreground">
            {Math.round(metrics.measuredRate * 100)}% measured citations
          </span>
        </div>
        <ExportButtons projectId={id} types={["visibility"]} />
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        {[
          { label: "Mention Rate", value: `${Math.round(metrics.mentionRate * 100)}%` },
          { label: "Citation Rate", value: `${Math.round(metrics.citationRate * 100)}%` },
          { label: "Share of Voice", value: `${Math.round(metrics.shareOfVoice * 100)}%` },
          { label: "Win Rate", value: `${Math.round(metrics.winRate * 100)}%` },
        ].map((m) => (
          <div key={m.label} className="bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-primary">{m.value}</div>
            <div className="text-sm text-muted-foreground">{m.label}</div>
          </div>
        ))}
      </div>

      {runDelta && (
        <CitationMovementPanel delta={runDelta} competitors={project.competitors || []} />
      )}

      <PromptImportPanel projectId={id} />
      <PromptHeatmap cells={heatmapCells} />

      <div>
        <h2 className="text-xl font-semibold mb-4">Visibility by Engine</h2>
        <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-3">
          {Object.entries(byEngine).map(([engine, stats]) => (
            <div key={engine} className="bg-card border border-border rounded-xl p-4">
              <div className="text-sm font-medium capitalize mb-2">{engine.replace(/_/g, " ")}</div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Prompts tested: {stats.total}</div>
                <div className="text-green-400">Mentioned: {stats.mentioned}</div>
                <div className="text-cyan-400">Cited: {stats.cited}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {runs && runs.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Scan History</h2>
          <div className="space-y-2">
            {runs.map((run) => (
              <div key={run.id} className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3 text-sm">
                <span>{new Date(run.created_at).toLocaleString()}</span>
                <span className="text-muted-foreground">{run.prompt_count} prompts · {run.engines?.join(", ")}</span>
                <span className={run.status === "completed" ? "text-green-400" : run.status === "running" ? "text-yellow-400" : "text-red-400"}>
                  {run.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-xl font-semibold mb-4">Prompt Results ({results.length})</h2>
        <VisibilityTable results={results} brandName={project.name} competitors={project.competitors || []} />
      </div>

      <AiTracesPanel projectId={id} />

      {prompts && prompts.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Tracked Prompts ({prompts.length})</h2>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-3">Prompt</th>
                  <th className="text-left p-3">Category</th>
                  <th className="text-right p-3">Priority</th>
                </tr>
              </thead>
              <tbody>
                {prompts.slice(0, 20).map((p) => (
                  <tr key={p.id} className="border-b border-border/50">
                    <td className="p-3">{p.text}</td>
                    <td className="p-3 text-muted-foreground">{p.category}</td>
                    <td className="p-3 text-right">{p.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
