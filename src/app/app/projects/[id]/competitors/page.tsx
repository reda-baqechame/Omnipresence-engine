import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { CompetitorIntel } from "@/components/competitor-intel";
import {
  competitorVisibilityRates,
  competitorWinPrompts,
  type EntityVisibilityRate,
} from "@/lib/engines/visibility-insights";
import { calculateShareOfVoice } from "@/lib/engines/share-of-voice";
import type { VisibilityResult } from "@/types/database";

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

  const [{ data: visibility }, { data: graph }] = await Promise.all([
    supabase.from("visibility_results").select("*").eq("project_id", id),
    supabase
      .from("backlink_graph_snapshots")
      .select("intersection, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const results = (visibility || []) as VisibilityResult[];
  const rates = competitorVisibilityRates(results, competitors);
  const aiRates: Record<string, EntityVisibilityRate> = { [project.domain]: rates.brand };
  for (const c of competitors) aiRates[c] = rates.competitors[c];

  const sov = calculateShareOfVoice(results, project.name, competitors);
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

      {/* Share of Voice leaderboard */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">AI Share of Voice</h3>
          <span className="text-xs text-muted-foreground">
            Prominence-weighted · {sov.sampleSize} measured answer{sov.sampleSize === 1 ? "" : "s"}
          </span>
        </div>
        {sov.sampleSize === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No measured AI answers yet. Run a visibility scan to populate Share of Voice.
          </p>
        ) : (
          <div className="mt-4 space-y-1.5">
            {sov.leaderboard.slice(0, 10).map((e, i) => (
              <div key={e.name} className="flex items-center gap-3 text-sm">
                <span className="w-5 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                <span className={`w-40 truncate shrink-0 ${e.isBrand ? "font-semibold text-primary" : ""}`}>
                  {e.name}
                  {e.isBrand && <span className="ml-1.5 text-[10px] uppercase text-primary">You</span>}
                </span>
                <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                  <div
                    className={e.isBrand ? "h-2 bg-primary" : "h-2 bg-muted-foreground/40"}
                    style={{ width: `${Math.round(e.shareOfVoice * 100)}%` }}
                  />
                </div>
                <span className="w-12 text-right tabular-nums">{Math.round(e.shareOfVoice * 100)}%</span>
                <span className="w-24 text-right text-xs text-muted-foreground">
                  {e.appearances} appear · pos {e.avgPosition?.toFixed(1) ?? "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

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
