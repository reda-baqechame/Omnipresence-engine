import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ScoreGauge, SubScoreBar } from "@/components/score-gauge";
import { FindingCard } from "@/components/finding-card";
import { ScoreHistoryChart } from "@/components/score-chart";
import { ScanPoller } from "@/components/scan-poller";
import { CompetitorChart } from "@/components/competitor-chart";
import { loadProjectVisibilitySnapshot } from "@/lib/engines/visibility-scope";
import { VisibilityHonestyBanner, VisibilityMetricTiles } from "@/components/visibility-honesty-banner";
import type { ExecutionTask } from "@/types/database";
import { getProject } from "@/lib/projects";
import { buildActionPlan } from "@/lib/engines/action-plan";
import { ActionPlanPanel } from "@/components/action-plan-panel";
import { buildPresenceGateScore } from "@/lib/scoring/presence-gate-builder";
import { PresenceGateCard } from "@/components/presence-gate-card";
import { isSubScoreAvailable, SCORE_DIMENSION_KEYS } from "@/lib/scoring/subscore-availability";
import { ProofEvidenceLinks } from "@/components/proof-evidence-links";
import { DataHealthSummaryCard } from "@/components/data-health-summary-card";
import { describeProviders } from "@/lib/providers/router";
import Link from "next/link";

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
    visibilitySnapshot,
    { data: brandProfile },
    { data: tasks },
  ] = await Promise.all([
    supabase.from("scores").select("*").eq("project_id", id).order("created_at", { ascending: true }),
    supabase.from("technical_findings").select("*").eq("project_id", id).order("severity"),
    supabase.from("coverage_items").select("*").eq("project_id", id),
    loadProjectVisibilitySnapshot(supabase, id, project.name, project.competitors || []),
    supabase.from("brand_profiles").select("*").eq("project_id", id).single(),
    supabase.from("execution_tasks").select("*").eq("project_id", id),
  ]);

  const actionPlan = buildActionPlan(id, (tasks || []) as ExecutionTask[]);
  const gate = await buildPresenceGateScore(supabase, id);

  const latestScore = scores?.[scores.length - 1];
  const measuredDimensions = latestScore
    ? SCORE_DIMENSION_KEYS.filter((k) => isSubScoreAvailable(latestScore, k)).length
    : 0;
  const allProviders = await describeProviders();
  const activeProviderCount = allProviders.filter((p) => p.usableNow).length;
  const missingProviderCount = allProviders.length - activeProviderCount;
  const previousScore = scores && scores.length >= 2 ? scores[scores.length - 2] : null;
  const scoreDelta = previousScore
    ? latestScore!.omnipresence_score - previousScore.omnipresence_score
    : null;
  const visibilityResults = visibilitySnapshot.allResults;
  const criticalFindings =
    findings?.filter((f) => f.severity === "critical" || f.severity === "high") || [];
  const missingCoverage =
    coverage?.filter((c) => !c.is_present && c.data_quality !== "unavailable") || [];

  return (
    <div className="space-y-8">
      <ScanPoller projectId={id} initialStatus={project.status} />

      <PresenceGateCard projectId={id} gate={gate} />

      <DataHealthSummaryCard
        projectId={id}
        measuredDimensions={measuredDimensions}
        totalDimensions={SCORE_DIMENSION_KEYS.length}
        activeProviderCount={activeProviderCount}
        missingProviderCount={missingProviderCount}
      />

      <ActionPlanPanel projectId={id} plan={actionPlan} />

      {latestScore ? (
        <>
          <div className="bg-card border border-border rounded-xl p-8">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
              <ProofEvidenceLinks projectId={id} />
              <Link
                href={`/app/projects/${id}/proof`}
                className="text-xs text-primary hover:underline shrink-0"
              >
                Full proof report →
              </Link>
            </div>
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
                <SubScoreBar
                  label="AI Visibility"
                  score={latestScore.ai_visibility}
                  available={isSubScoreAvailable(latestScore, "ai_visibility")}
                />
                <SubScoreBar
                  label="Search Visibility"
                  score={latestScore.search_visibility}
                  available={isSubScoreAvailable(latestScore, "search_visibility")}
                />
                <SubScoreBar
                  label="Local Visibility"
                  score={latestScore.local_visibility}
                  available={isSubScoreAvailable(latestScore, "local_visibility")}
                />
                <SubScoreBar
                  label="Social Presence"
                  score={latestScore.social_presence}
                  available={isSubScoreAvailable(latestScore, "social_presence")}
                />
                <SubScoreBar
                  label="Directory Coverage"
                  score={latestScore.directory_coverage}
                  available={isSubScoreAvailable(latestScore, "directory_coverage")}
                />
                <SubScoreBar
                  label="Authority Mentions"
                  score={latestScore.authority_mentions}
                  available={isSubScoreAvailable(latestScore, "authority_mentions")}
                />
                <SubScoreBar
                  label="Technical Readiness"
                  score={latestScore.technical_readiness}
                  available={isSubScoreAvailable(latestScore, "technical_readiness")}
                />
                <SubScoreBar
                  label="Conversion Readiness"
                  score={latestScore.conversion_readiness}
                  available={isSubScoreAvailable(latestScore, "conversion_readiness")}
                />
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

          {visibilitySnapshot.groundedCount > 0 && (
            <CompetitorChart
              results={visibilitySnapshot.groundedResults}
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

      {visibilityResults.length > 0 && (
        <div className="space-y-4">
          <VisibilityHonestyBanner snapshot={visibilitySnapshot} />
          <VisibilityMetricTiles snapshot={visibilitySnapshot} />
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
            {coverage?.map((c) => {
              const tone = c.is_present
                ? "bg-green-500/10 text-green-400"
                : c.data_quality === "unavailable"
                  ? "bg-secondary/50 text-muted-foreground"
                  : "bg-red-500/10 text-red-400";
              const mark = c.is_present ? "✓" : c.data_quality === "unavailable" ? "?" : "✗";
              return (
                <div key={c.id} className={`text-sm px-3 py-2 rounded-lg ${tone}`}>
                  {mark} {c.platform_name}
                </div>
              );
            })}
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
