import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { calculateAeoReadiness, type AeoLever, type AeoReadiness } from "@/lib/engines/aeo-readiness";
import { calculateAeoMetrics } from "@/lib/engines/aeo-metrics";
import { assessCitationGates, type GateAssessment } from "@/lib/engines/gate-assessment";
import type { TechnicalAuditFinding } from "@/lib/engines/technical-audit";
import { PassageRewriterPanel } from "@/components/passage-rewriter-panel";
import type { VisibilityResult, TechnicalFinding } from "@/types/database";

function barColor(status: AeoLever["status"]): string {
  if (status === "strong") return "bg-green-500";
  if (status === "moderate") return "bg-yellow-500";
  return "bg-red-500";
}

export default async function AeoReadinessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const [{ data: stored }, { data: findings }, { data: visibility }, { data: entity }, { data: coverage }, { data: authority }] =
    await Promise.all([
      supabase.from("aeo_readiness").select("*").eq("project_id", id).maybeSingle(),
      supabase.from("technical_findings").select("category, severity, title, fix_recommendation").eq("project_id", id),
      supabase.from("visibility_results").select("*").eq("project_id", id),
      supabase.from("entity_profiles").select("entity_score").eq("project_id", id).maybeSingle(),
      supabase.from("coverage_items").select("surface, is_present").eq("project_id", id),
      supabase.from("authority_opportunities").select("status").eq("project_id", id),
    ]);

  const results = (visibility || []) as VisibilityResult[];

  const readiness: AeoReadiness =
    stored && Array.isArray(stored.levers) && stored.levers.length > 0
      ? {
          readinessScore: stored.readiness_score ?? 0,
          deterministicScore: stored.deterministic_score ?? 0,
          probabilisticScore: stored.probabilistic_score ?? 0,
          levers: stored.levers as AeoLever[],
          deterministicDeliverablesMet: stored.deterministic_deliverables_met ?? false,
          nextBestActions: (stored.next_best_actions as string[]) ?? [],
        }
      : calculateAeoReadiness({
          technicalFindings: (findings || []) as Array<Pick<TechnicalFinding, "category" | "severity" | "title" | "fix_recommendation">>,
          visibilityResults: results,
          entityScore: entity?.entity_score ?? undefined,
          coverageItems: coverage || [],
          authorityOpportunities: authority || [],
          domainAuthority: stored?.domain_authority ?? undefined,
          pageSpeedScore: stored?.page_speed_score ?? undefined,
        });

  const aeoMetrics = calculateAeoMetrics(results, project.name, project.competitors || []);

  // 4-gate citation funnel — derived live from persisted technical findings.
  // Each gate must pass for an AI engine to index → crawl → retrieve → cite you.
  const citation = assessCitationGates((findings || []) as TechnicalAuditFinding[]);

  const deterministic = readiness.levers.filter((l) => l.type === "deterministic");
  const probabilistic = readiness.levers.filter((l) => l.type === "probabilistic");

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold mb-1">AEO Readiness</h2>
        <p className="text-sm text-muted-foreground">
          Seven levers that decide whether AI engines cite you. Deterministic levers are controllable and guaranteed; probabilistic levers are influenced and proven by the measured visibility delta.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-6 text-center">
          <div className="text-4xl font-bold text-primary">{readiness.readinessScore}</div>
          <div className="text-sm text-muted-foreground mt-1">AEO Readiness Score</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-6 text-center">
          <div className="text-4xl font-bold text-green-400">{readiness.deterministicScore}</div>
          <div className="text-sm text-muted-foreground mt-1">Deterministic (guaranteed)</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-6 text-center">
          <div className="text-4xl font-bold text-cyan-400">{readiness.probabilisticScore}</div>
          <div className="text-sm text-muted-foreground mt-1">Probabilistic (measured)</div>
        </div>
      </div>

      <CitationGatePanel
        gates={citation.gates}
        blocker={citation.timeToCitationBlocker}
        overallPassed={citation.overallPassed}
      />

      {readiness.nextBestActions.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold mb-3">Next best actions (deterministic first)</h3>
          <ol className="space-y-2 text-sm list-decimal list-inside">
            {readiness.nextBestActions.map((a, i) => (
              <li key={i} className="text-muted-foreground">{a}</li>
            ))}
          </ol>
        </div>
      )}

      <LeverGroup title="Deterministic levers (guaranteed deliverables)" levers={deterministic} />
      <LeverGroup title="Probabilistic levers (measured lift)" levers={probabilistic} />

      <PassageRewriterPanel projectId={id} />

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold mb-3">Authority &amp; speed</h3>
          <div className="text-sm space-y-2">
            <div className="flex justify-between border-b border-border pb-2">
              <span>Domain authority (Tranco)</span>
              <span className="text-primary">{stored?.domain_authority ?? "—"}{stored?.domain_authority ? "/100" : ""}</span>
            </div>
            <div className="flex justify-between">
              <span>Page speed (retrieval health)</span>
              <span className="text-primary">{stored?.page_speed_score ?? "—"}{stored?.page_speed_score ? "/100" : ""}</span>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold mb-3">Citations by engine (measured)</h3>
          <div className="text-sm space-y-2">
            {Object.entries(aeoMetrics.engineBreakdown).map(([engine, s]) => (
              <div key={engine} className="flex justify-between border-b border-border pb-2 last:border-0">
                <span className="capitalize">{engine.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground">
                  {s.citations}/{s.prompts} cited · {s.mentions} mentions
                </span>
              </div>
            ))}
            {Object.keys(aeoMetrics.engineBreakdown).length === 0 && (
              <p className="text-muted-foreground">Run a scan to populate measured citations.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CitationGatePanel({
  gates,
  blocker,
  overallPassed,
}: {
  gates: GateAssessment[];
  blocker?: string;
  overallPassed: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold">Citation funnel — 4 gates to get cited</h3>
        <span
          className={`text-xs px-2 py-0.5 rounded-full border ${
            overallPassed
              ? "border-green-500/40 text-green-400"
              : "border-yellow-500/40 text-yellow-400"
          }`}
        >
          {overallPassed ? "All gates clear" : "Blocked"}
        </span>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        An AI engine can only cite you if you pass every gate in order: indexed → crawlable by AI bots → retrieval-ready → backed by citation signals.
      </p>

      {blocker && !overallPassed && (
        <div className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          Top blocker: {blocker}
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {gates.map((g) => (
          <div key={g.gate} className="border border-border rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{g.label}</span>
              <span className={g.passed ? "text-green-400" : "text-red-400"}>
                {g.passed ? "✓" : "✕"}
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-2">
              <div
                className={`h-full ${g.passed ? "bg-green-500" : g.score >= 40 ? "bg-yellow-500" : "bg-red-500"}`}
                style={{ width: `${g.score}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground">{g.score}/100</div>
            {g.blockers.length > 0 && (
              <ul className="mt-2 text-xs text-red-400 space-y-1">
                {g.blockers.slice(0, 2).map((b, i) => (
                  <li key={i}>• {b}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LeverGroup({ title, levers }: { title: string; levers: AeoLever[] }) {
  if (levers.length === 0) return null;
  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">{title}</h3>
      <div className="space-y-4">
        {levers.map((lever) => (
          <div key={lever.id} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{lever.name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                  {lever.type}
                </span>
              </div>
              <span className="text-sm font-semibold">{lever.score}/100</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden mb-2">
              <div className={`h-full ${barColor(lever.status)}`} style={{ width: `${lever.score}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{lever.nextAction}</p>
            {lever.blockers.length > 0 && (
              <ul className="mt-2 text-xs text-red-400 space-y-1">
                {lever.blockers.slice(0, 3).map((b, i) => (
                  <li key={i}>• {b}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
