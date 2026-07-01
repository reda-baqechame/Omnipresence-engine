import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { getLedgerForProject } from "@/lib/engines/results-ledger";
import { calculateVisibilityMetrics } from "@/lib/engines/visibility-scanner";
import { buildTwoTierGuarantee, evaluateMarketingGate } from "@/lib/engines/guarantee";
import type { AeoLever } from "@/lib/engines/aeo-readiness";
import { GuaranteePanel } from "@/components/guarantee-panel";
import { buildPresenceGateScore } from "@/lib/scoring/presence-gate-builder";
import { getGateLabel } from "@/lib/scoring/presence-gate";

export default async function GuaranteePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const [{ data: contract }, { data: claims }, ledger, { data: latestScore }, { data: visibility }, { data: readiness }] =
    await Promise.all([
      supabase.from("guarantee_contracts").select("*").eq("project_id", id).maybeSingle(),
      supabase.from("guarantee_claims").select("*").eq("project_id", id).order("created_at", { ascending: false }),
      getLedgerForProject(supabase, id, 30),
      supabase.from("scores").select("omnipresence_score").eq("project_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("visibility_results").select("brand_mentioned, brand_cited, competitor_mentions, raw_response").eq("project_id", id),
      supabase.from("aeo_readiness").select("levers").eq("project_id", id).maybeSingle(),
    ]);

  const visibilityMetrics = calculateVisibilityMetrics(visibility || []);
  const levers = (readiness?.levers as AeoLever[] | undefined) || [];
  const twoTier = buildTwoTierGuarantee(levers, "citation_rate");

  const gate = await buildPresenceGateScore(supabase, id);
  const gateLabel = getGateLabel(gate.score);
  const marketingGate = evaluateMarketingGate({
    presenceGateScore: gate.score,
    presenceGateReady: gate.ready,
    limitingGate: gate.limitingGate ?? undefined,
  });

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold">PresenceOS Score (minimum-gate)</h3>
            <p className="text-sm text-muted-foreground mt-1">
              The composite is the weakest critical gate — you are only as proven as your
              least-ready capability.{" "}
              {gate.ready
                ? "All critical gates are ready: outcome guarantee permitted."
                : `Limiting gate: ${gate.limitingGate?.replace(/_/g, " ") ?? "none"}.`}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-3xl font-bold ${gateLabel.color}`}>{Math.round(gate.score)}</div>
            <div className={`text-xs font-medium ${gateLabel.color}`}>{gateLabel.label}</div>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mt-4">
          {gate.gates.map((g) => {
            const isLimiting = g.gate === gate.limitingGate;
            return (
              <div
                key={g.gate}
                className={`rounded-lg border px-3 py-2 ${
                  isLimiting ? "border-amber-500/50 bg-amber-500/5" : "border-border"
                }`}
                title={g.detail}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs capitalize">{g.gate.replace(/_/g, " ")}</span>
                  <span className="text-xs font-medium">{Math.round(g.score)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted">
                  <div
                    className={`h-1.5 rounded-full ${isLimiting ? "bg-amber-500" : "bg-primary"}`}
                    style={{ width: `${Math.min(g.score, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Gate coverage: {Math.round(gate.coverage * 100)}% of critical gates evaluated.
        </p>
      </div>

      <GuaranteePanel
        projectId={id}
        contract={contract}
        claims={claims || []}
        ledger={ledger}
        latestMetrics={{
          omnipresence_score: latestScore?.omnipresence_score ?? 0,
          citation_rate: visibilityMetrics.citationRate,
          visibility_mention_rate: visibilityMetrics.mentionRate,
        }}
        twoTier={twoTier}
        marketingGate={marketingGate}
      />
    </div>
  );
}
