import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ScoreGauge, SubScoreBar } from "@/components/score-gauge";
import { FindingCard } from "@/components/finding-card";
import { ScoreHistoryChart } from "@/components/score-chart";
import { ScanPoller } from "@/components/scan-poller";
import { CompetitorChart } from "@/components/competitor-chart";
import { calculateVisibilityMetrics } from "@/lib/engines/visibility-scanner";
import type { VisibilityResult, ExecutionTask } from "@/types/database";
import { getProject } from "@/lib/projects";
import { buildActionPlan } from "@/lib/engines/action-plan";
import { ActionPlanPanel } from "@/components/action-plan-panel";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();

  const [
    { data: scores },
    { data: findings },
    { data: coverage },
    { data: visibility },
    { data: brandProfile },
    { data: tasks },
  ] = await Promise.all([
    supabase.from("scores").select("*").eq("project_id", id).order("created_at", { ascending: true }),
    supabase.from("technical_findings").select("*").eq("project_id", id).order("severity"),
    supabase.from("coverage_items").select("*").eq("project_id", id),
    supabase.from("visibility_results").select("*").eq("project_id", id),
    supabase.from("brand_profiles").select("*").eq("project_id", id).single(),
    supabase.from("execution_tasks").select("*").eq("project_id", id),
  ]);

  const actionPlan = buildActionPlan(id, (tasks || []) as ExecutionTask[]);

  const latestScore = scores?.[scores.length - 1];
  const previousScore = scores && scores.length >= 2 ? scores[scores.length - 2] : null;
  const scoreDelta = previousScore
    ? latestScore!.omnipresence_score - previousScore.omnipresence_score
    : null;
  const visibilityMetrics = calculateVisibilityMetrics((visibility || []) as VisibilityResult[]);
  const criticalFindings =
    findings?.filter((f) => f.severity === "critical" || f.severity === "high") || [];
  const missingCoverage = coverage?.filter((c) => !c.is_present) || [];

  return (
    <div className="space-y-8">
      <ScanPoller projectId={id} initialStatus={project.status} />

      <ActionPlanPanel projectId={id} plan={actionPlan} />

      {latestScore ? (
        <>
          <div className="bg-card border border-border rounded-xl p-8">
            <div className="grid md:grid-cols-3 gap-8">
              <div>
                <ScoreGauge score={latestScore.omnipresence_score} label="OmniPresence Score" size="lg" />
                {scoreDelta !== null && (
                  <p className={`text-sm text-center mt-2 ${scoreDelta >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {scoreDelta >= 0 ? "+" : ""}
                    {Math.round(scoreDelta)} vs last scan
                  </p>
                )}
              </div>
              <div className="md:col-span-2 space-y-3">
                <SubScoreBar label="AI Visibility" score={latestScore.ai_visibility} />
                <SubScoreBar label="Search Visibility" score={latestScore.search_visibility} />
                <SubScoreBar label="Local Visibility" score={latestScore.local_visibility} />
                <SubScoreBar label="Social Presence" score={latestScore.social_presence} />
                <SubScoreBar label="Directory Coverage" score={latestScore.directory_coverage} />
                <SubScoreBar label="Authority Mentions" score={latestScore.authority_mentions} />
                <SubScoreBar label="Technical Readiness" score={latestScore.technical_readiness} />
                <SubScoreBar label="Conversion Readiness" score={latestScore.conversion_readiness} />
              </div>
            </div>
          </div>

          {(scores?.length ?? 0) > 1 && (
            <ScoreHistoryChart
              data={(scores || []).map((s) => ({
                date: new Date(s.created_at).toLocaleDateString(),
                score: s.omnipresence_score,
                ai: s.ai_visibility,
                search: s.search_visibility,
              }))}
            />
          )}

          {visibility && visibility.length > 0 && (
            <CompetitorChart
              results={visibility as VisibilityResult[]}
              brandName={project.name}
              competitors={project.competitors || []}
            />
          )}
        </>
      ) : (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          No scan data yet. Click Re-scan to run your first OmniPresence audit.
        </div>
      )}

      {visibility && visibility.length > 0 && (
        <div className="grid md:grid-cols-4 gap-4">
          {[
            { label: "Mention Rate", value: `${Math.round(visibilityMetrics.mentionRate * 100)}%` },
            { label: "Citation Rate", value: `${Math.round(visibilityMetrics.citationRate * 100)}%` },
            { label: "Share of Voice", value: `${Math.round(visibilityMetrics.shareOfVoice * 100)}%` },
            { label: "Win Rate", value: `${Math.round(visibilityMetrics.winRate * 100)}%` },
          ].map((m) => (
            <div key={m.label} className="bg-card border border-border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-primary">{m.value}</div>
              <div className="text-sm text-muted-foreground">{m.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-8">
        <div>
          <h2 className="text-xl font-semibold mb-4">Critical Issues ({criticalFindings.length})</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {criticalFindings.length > 0 ? (
              criticalFindings.map((f) => (
                <FindingCard
                  key={f.id}
                  title={f.title}
                  description={f.description}
                  severity={f.severity}
                  fix={f.fix_recommendation}
                  category={f.category}
                />
              ))
            ) : (
              <p className="text-muted-foreground text-sm">No critical issues found.</p>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-4">Platform Coverage</h2>
          <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
            {coverage?.map((c) => (
              <div
                key={c.id}
                className={`text-sm px-3 py-2 rounded-lg ${
                  c.is_present ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                }`}
              >
                {c.is_present ? "✓" : "✗"} {c.platform_name}
              </div>
            ))}
          </div>
          {missingCoverage.length > 0 && (
            <p className="text-sm text-muted-foreground mt-3">{missingCoverage.length} platforms missing</p>
          )}
        </div>
      </div>

      {brandProfile && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Brand Intelligence</h2>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Voice:</span> {brandProfile.brand_voice}
            </div>
            <div>
              <span className="text-muted-foreground">Values:</span>{" "}
              {(brandProfile.brand_values || []).join(", ")}
            </div>
            <div>
              <span className="text-muted-foreground">Audiences:</span>{" "}
              {(brandProfile.target_audiences || []).join(", ")}
            </div>
            <div>
              <span className="text-muted-foreground">Persona:</span> {brandProfile.author_persona}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
