/**
 * Source influence scoring v2 (Wave P2) — the "win these 3 sources" engine.
 *
 * The base graph scores a source by AI-citation frequency + competitor overlap +
 * reachability. v2 broadens this into the full professional signal set the
 * research calls for, computed from ALREADY-MEASURED data plus the freshly
 * enriched domain authority:
 *
 *   citation frequency + SERP frequency + competitor dependency + brand absence
 *   + authority + buyer intent + contactability  → 0-100 influence
 *
 * It rewrites `source_opportunities.influence_score`, stores the signal
 * breakdown + a projected impact in `evidence.influence_v2`, and returns the
 * ranked "win these first" list. Nothing is invented — a source with no measured
 * signal stays low.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyIntent } from "@/lib/engines/source-graph";
import { logProviderError } from "@/lib/observability/log";

interface DomainStat {
  ai_citation_count: number;
  serp_rank_count: number;
  competitor_mention_count: number;
  brand_mention_count: number;
  authority: number | null;
  reachability: number | null;
}

const INTENT_WEIGHT: Record<string, number> = {
  transactional: 10,
  commercial: 8,
  navigational: 4,
  informational: 2,
};

export interface RankedSource {
  id: string;
  domain: string;
  influence: number;
  recommended_action: string | null;
  projected_impact: number;
}

export interface InfluenceV2Result {
  scored: number;
  top: RankedSource[];
}

function dominantIntent(prompts: string[]): string {
  if (!prompts.length) return "informational";
  const counts: Record<string, number> = {};
  for (const p of prompts) {
    const intent = classifyIntent(p);
    counts[intent] = (counts[intent] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Recompute v2 influence for a project's open source opportunities and return the
 * ranked shortlist (highest influence first). Best-effort: returns an empty
 * result rather than throwing into the scan pipeline.
 */
export async function scoreSourceInfluenceV2(
  supabase: SupabaseClient,
  projectId: string,
  topN = 3
): Promise<InfluenceV2Result> {
  try {
    const [{ data: domains }, { data: opps }] = await Promise.all([
      supabase
        .from("source_domains")
        .select("domain, ai_citation_count, serp_rank_count, competitor_mention_count, brand_mention_count, authority, reachability")
        .eq("project_id", projectId),
      supabase
        .from("source_opportunities")
        .select("id, source_domain, recommended_action, evidence, difficulty")
        .eq("project_id", projectId)
        .eq("status", "open"),
    ]);

    if (!opps || opps.length === 0) return { scored: 0, top: [] };

    const statByDomain = new Map<string, DomainStat>();
    for (const d of domains || []) statByDomain.set(d.domain, d as DomainStat);

    const maxAi = Math.max(1, ...(domains || []).map((d) => d.ai_citation_count || 0));
    const maxSerp = Math.max(1, ...(domains || []).map((d) => d.serp_rank_count || 0));
    const maxComp = Math.max(1, ...(domains || []).map((d) => d.competitor_mention_count || 0));

    const ranked: RankedSource[] = [];

    for (const opp of opps) {
      const stat = statByDomain.get(opp.source_domain) || {
        ai_citation_count: 0,
        serp_rank_count: 0,
        competitor_mention_count: opp.evidence?.competitors?.length || 0,
        brand_mention_count: 0,
        authority: null,
        reachability: null,
      };
      const prompts: string[] = Array.isArray(opp.evidence?.prompts) ? opp.evidence.prompts : [];
      const intent = dominantIntent(prompts);

      const citationFreq = (stat.ai_citation_count / maxAi) * 25;
      const serpFreq = (stat.serp_rank_count / maxSerp) * 10;
      const competitorDependency = (stat.competitor_mention_count / maxComp) * 20;
      const brandAbsence = stat.brand_mention_count === 0 ? 15 : 0;
      // Unenriched authority defaults to a neutral 40 so we don't unfairly zero
      // a source that simply hasn't been resolved yet.
      const authorityScore = ((stat.authority ?? 40) / 100) * 15;
      const intentScore = INTENT_WEIGHT[intent] ?? 2;
      const contactability = ((stat.reachability ?? 50) / 100) * 5;

      const influence = Math.round(
        Math.min(100, citationFreq + serpFreq + competitorDependency + brandAbsence + authorityScore + intentScore + contactability)
      );

      // Projected impact = influence tempered by how hard the source is to win.
      const difficulty = typeof opp.difficulty === "number" ? opp.difficulty : 50;
      const projectedImpact = Math.round(influence * (1 - difficulty / 200));

      const breakdown = {
        citation_freq: Math.round(citationFreq),
        serp_freq: Math.round(serpFreq),
        competitor_dependency: Math.round(competitorDependency),
        brand_absence: brandAbsence,
        authority: Math.round(authorityScore),
        intent,
        intent_score: intentScore,
        contactability: Math.round(contactability),
        projected_impact: projectedImpact,
      };

      await supabase
        .from("source_opportunities")
        .update({
          influence_score: influence,
          evidence: { ...(opp.evidence || {}), influence_v2: breakdown },
          updated_at: new Date().toISOString(),
        })
        .eq("id", opp.id);

      ranked.push({
        id: opp.id,
        domain: opp.source_domain,
        influence,
        recommended_action: opp.recommended_action ?? null,
        projected_impact: projectedImpact,
      });
    }

    ranked.sort((a, b) => b.influence - a.influence);
    return { scored: ranked.length, top: ranked.slice(0, topN) };
  } catch (error) {
    logProviderError("sourceInfluence.v2", error, { projectId });
    return { scored: 0, top: [] };
  }
}

/**
 * Create execution tasks for the top influence-ranked open source opportunities.
 * Upserts by deterministic source_id so rescans refresh task metadata, not dupes.
 */
export async function createTopInfluenceOutreachTasks(
  supabase: SupabaseClient,
  projectId: string,
  limit = 3
): Promise<number> {
  const [{ data: project }, { data: opps }] = await Promise.all([
    supabase.from("projects").select("organization_id").eq("id", projectId).single(),
    supabase
      .from("source_opportunities")
      .select("id, source_domain, influence_score, difficulty, recommended_action")
      .eq("project_id", projectId)
      .eq("status", "open")
      .order("influence_score", { ascending: false })
      .limit(limit),
  ]);

  if (!project?.organization_id || !opps?.length) return 0;

  const rows = opps.map((opp) => {
    const influence = Number(opp.influence_score) || 0;
    const difficulty = typeof opp.difficulty === "number" ? opp.difficulty : 50;
    return {
      project_id: projectId,
      organization_id: project.organization_id,
      title: `Outreach: win ${opp.source_domain} citation`,
      description:
        opp.recommended_action ||
        `Earn a brand mention/citation on ${opp.source_domain} where competitors are already cited.`,
      source_module: "source_opportunity" as const,
      source_id: `outreach:${opp.id}`,
      category: "authority",
      priority: influence >= 70 ? "high" : influence >= 45 ? "medium" : "low",
      impact: Math.min(100, Math.max(0, Math.round(influence))),
      effort: difficulty >= 60 ? 5 : difficulty >= 40 ? 4 : 3,
      status: "todo" as const,
      evidence: { source_domain: opp.source_domain, influence_score: influence },
    };
  });

  await supabase.from("execution_tasks").upsert(rows, {
    onConflict: "project_id,source_module,source_id",
  });

  return rows.length;
}
