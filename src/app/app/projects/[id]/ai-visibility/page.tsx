import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { measuredEngineStats } from "@/lib/engines/visibility-insights";
import { loadProjectVisibilitySnapshot } from "@/lib/engines/visibility-scope";
import { buildPromptTripleMetrics } from "@/lib/engines/visibility-triple-metric";
import { preferLiveData } from "@/lib/config/capabilities";
import { getProject } from "@/lib/projects";
import { ProjectHubPage } from "@/components/project-hub-page";
import { VisibilityTable } from "@/components/visibility-table";
import { ShareOfAiVoiceKpi } from "@/components/share-of-ai-voice-kpi";
import { VisibilityTripleTable } from "@/components/visibility-triple-table";
import { VisibilityHonestyBanner, VisibilityMetricTiles } from "@/components/visibility-honesty-banner";

export default async function AiVisibilityHub({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const snapshot = await loadProjectVisibilitySnapshot(
    supabase,
    id,
    project.name,
    project.competitors || []
  );
  const { scopedResults, groundedResults } = snapshot;
  const engineStats = measuredEngineStats(scopedResults);
  const tripleMetrics = buildPromptTripleMetrics(scopedResults);
  const liveMode = preferLiveData();

  return (
    <ProjectHubPage
      title="AI Visibility"
      description="Measure where the brand appears in AI answers, which prompts matter, and which cited sources control the recommendation set."
      projectId={id}
      tools={[
        { href: "/visibility", title: "AI answer visibility", description: "Measured prompt-by-engine results with citations, competitor wins, and source gaps.", status: "measured" },
        { href: "/prompts", title: "Tracked prompts", description: "Buyer questions and recommendation prompts used for repeatable AI visibility measurement.", status: "measured" },
        { href: "/panels", title: "Prompt panels", description: "Panel-level sampling so answer volatility is visible instead of hidden.", status: "measured" },
        { href: "/crawlers", title: "AI crawler access", description: "Robots, crawlability, and AI bot access checks that can block retrieval.", status: "measured" },
        { href: "/aeo-readiness", title: "AEO readiness", description: "Deterministic levers: entity clarity, crawlability, citations, and answer readiness.", status: "measured" },
        { href: "/intelligence", title: "AEO intelligence", description: "Research signals and strategic context that explain why visibility is moving.", status: "workflow" },
        { href: "/geo-lift", title: "GEO lift experiments", description: "Before/after measurement for content changes intended to improve AI citations.", status: "workflow" },
        { href: "/frontier", title: "Frontier opportunities", description: "Experimental surfaces kept separate from measured scorecards.", status: "workflow" },
        { href: "/source-graph", title: "Citation source graph", description: "Which domains influence AI answers — Profound-class source influence map.", status: "measured" },
      ]}
    >
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${liveMode ? "bg-green-500/10 text-green-400 border border-green-500/30" : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30"}`}>
          {liveMode ? "Live measured stack" : "Providers not configured"}
        </span>
        {snapshot.latestRun && (
          <span className="text-muted-foreground">
            Latest run: {snapshot.groundedCount} grounded · {snapshot.modelKnowledgeCount} model-knowledge · {snapshot.unavailableCount} unavailable
          </span>
        )}
      </div>

      {scopedResults.length > 0 ? (
        <>
          <VisibilityHonestyBanner snapshot={snapshot} />
          <VisibilityMetricTiles snapshot={snapshot} />

          <ShareOfAiVoiceKpi sov={snapshot.sov} />

          <div>
            <h3 className="text-lg font-semibold mb-3">Visibility · Position · Sentiment (per prompt)</h3>
            <p className="text-xs text-muted-foreground mb-3">Peec-style triple metric from grounded probes — mention rate, answer slot, and sentiment per engine.</p>
            <VisibilityTripleTable rows={tripleMetrics} />
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-3">Visibility by engine</h3>
            <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-3">
              {engineStats.map((stats) => (
                <div key={stats.engine} className="bg-card border border-border rounded-xl p-4">
                  <div className="text-sm font-medium capitalize mb-2">{stats.engine.replace(/_/g, " ")}</div>
                  {stats.grounded + stats.modelKnowledge === 0 ? (
                    <div className="text-xs text-muted-foreground">Not measured this run</div>
                  ) : (
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>Grounded: {stats.grounded} · Model: {stats.modelKnowledge}</div>
                      <div className="text-green-400">Mentioned: {stats.mentionRate != null ? `${Math.round(stats.mentionRate * 100)}%` : "—"}</div>
                      <div className="text-cyan-400">Cited (grounded): {stats.citationRate != null ? `${Math.round(stats.citationRate * 100)}%` : "—"}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-3">Latest grounded answers</h3>
            <VisibilityTable
              results={groundedResults.slice(0, 20)}
              brandName={project.name}
              competitors={project.competitors || []}
              projectId={id}
            />
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          No AI visibility probes yet. Run a scan from the project header to measure where you appear in AI answers.
        </div>
      )}
    </ProjectHubPage>
  );
}
