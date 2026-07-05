import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { CompetitorIntel } from "@/components/competitor-intel";
import { ShareOfAiVoiceKpi } from "@/components/share-of-ai-voice-kpi";
import { PopularityPanel } from "@/components/popularity-panel";
import { buildPopularityPanelRows } from "@/lib/engines/popularity-panel-data";
import {
  competitorVisibilityRates,
  competitorWinPrompts,
  type EntityVisibilityRate,
} from "@/lib/engines/visibility-insights";
import { loadProjectVisibilitySnapshot } from "@/lib/engines/visibility-scope";

export const dynamic = "force-dynamic";

interface IntersectionRow {
  source_domain?: string;
  links_to?: string[];
  count?: number;
  authority?: number;
  brand_gap?: boolean;
}

export default async function CompetitorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const competitors = project.competitors || [];
  const supabase = await createClient();

  const [{ scopedResults, sov }, { data: graph }, popularityRows] = await Promise.all([
    loadProjectVisibilitySnapshot(supabase, id, project.name, competitors),
    supabase
      .from("backlink_graph_snapshots")
      .select("intersection, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    buildPopularityPanelRows(project.domain, competitors, project.name),
  ]);

  const results = scopedResults;
  const rates = competitorVisibilityRates(results, competitors);
  const aiRates: Record<string, EntityVisibilityRate> = { [project.domain]: rates.brand };
  for (const c of competitors) aiRates[c] = rates.competitors[c];

  const sovLeaderboard = sov;
  const winPrompts = competitorWinPrompts(results, 20);

  const intersection = ((graph?.intersection as IntersectionRow[] | null) || []).filter((r) => r.brand_gap);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Competitor Research Hub</h2>
        <p className="text-sm text-muted-foreground mt-1">
          One head-to-head view: popularity/authority/tech matrix, prominence-weighted AI Share of Voice, the prompts
          competitors win that you don&apos;t, and the referring domains linking to rivals but not you. Every number is
          measured or honestly labeled — never fabricated.
        </p>
      </div>

      {/* Share of Voice headline KPI */}
      <ShareOfAiVoiceKpi sov={sovLeaderboard} />

      <PopularityPanel rows={popularityRows} />

      {/* Competitive matrix (existing engine) */}
      <CompetitorIntel domain={project.domain} competitors={competitors} brandName={project.name} aiRates={aiRates} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Prompts competitors win */}
        <div className="rounded-xl border border-border p-4">
          <h3 className="font-semibold">Prompts competitors win (you don&apos;t)</h3>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            Measured AI answers where a competitor is named/cited but your brand is absent — your highest-leverage
            content/AEO targets.
          </p>
          {winPrompts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No competitor-win gaps in measured probes. 🎉</p>
          ) : (
            <ul className="space-y-2 text-sm max-h-96 overflow-y-auto">
              {winPrompts.map((w, i) => (
                <li key={i} className="border-b border-border/40 pb-2">
                  <div className="font-medium">{w.prompt}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {w.engine} · won by {w.competitors.join(", ")}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Backlink intersection gap */}
        <div className="rounded-xl border border-border p-4">
          <h3 className="font-semibold">Backlink gap — domains linking to rivals, not you</h3>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            From the latest Presence Backlink Graph intersection. Prioritized outreach targets.
          </p>
          {intersection.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No backlink intersection gaps{graph ? "" : " yet — run a backlink graph refresh"}.
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm max-h-96 overflow-y-auto">
              {intersection.slice(0, 30).map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{r.source_domain}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {r.count ?? 0} rival{(r.count ?? 0) === 1 ? "" : "s"}
                    {typeof r.authority === "number" ? ` · auth ${r.authority}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
