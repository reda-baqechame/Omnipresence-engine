import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeFastestPath,
  type FastestPathContext,
  type FastestPathItem,
} from "@/lib/engines/fastest-path";

const PRIORITY_FROM_SCORE = (score: number): "critical" | "high" | "medium" | "low" =>
  score >= 75 ? "critical" : score >= 55 ? "high" : score >= 35 ? "medium" : "low";

const EFFORT_HOURS: Record<FastestPathItem["effort"], number> = { low: 1, medium: 3, high: 6 };

/**
 * Assemble the fastest-path context for a project from real signals: domain
 * authority, locality, competitors, low-difficulty keyword opportunities,
 * missing coverage surfaces, and AI citation-gap source domains.
 */
export async function buildFastestPathContext(
  supabase: SupabaseClient,
  projectId: string
): Promise<FastestPathContext> {
  const { data: project } = await supabase
    .from("projects")
    .select("industry, location")
    .eq("id", projectId)
    .maybeSingle();

  const [{ data: latestScore }, { data: keywords }, { data: coverage }, { data: sourceOpps }, { data: competitors }] =
    await Promise.all([
      supabase
        .from("scores")
        .select("breakdown, authority_mentions")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("keyword_opportunities")
        .select("keyword, difficulty, volume_estimate, opportunity_score")
        .eq("project_id", projectId)
        .order("opportunity_score", { ascending: false })
        .limit(30),
      supabase
        .from("coverage_items")
        .select("platform_name, surface, is_present, data_quality")
        .eq("project_id", projectId)
        .eq("is_present", false),
      supabase
        .from("source_opportunities")
        .select("source_domain, influence_score, difficulty, status")
        .eq("project_id", projectId)
        .eq("status", "open")
        .order("influence_score", { ascending: false })
        .limit(10),
      supabase.from("competitors").select("id").eq("project_id", projectId),
    ]);

  const breakdown = (latestScore?.breakdown as { domain_authority?: number } | null) || {};
  const domainAuthority =
    typeof breakdown.domain_authority === "number"
      ? breakdown.domain_authority
      : typeof latestScore?.authority_mentions === "number"
        ? Number(latestScore.authority_mentions)
        : undefined;

  const isLocal = Boolean(project?.location);

  return {
    domainAuthority,
    isLocal,
    competitorCount: (competitors || []).length,
    longTailKeywords: (keywords || []).map((k) => ({
      keyword: k.keyword,
      difficulty: typeof k.difficulty === "number" ? k.difficulty : undefined,
      volume: typeof k.volume_estimate === "number" ? k.volume_estimate : undefined,
    })),
    missingDirectories: (coverage || [])
      .filter((c) => c.data_quality !== "unavailable")
      .map((c) => ({ name: c.platform_name as string, surface: c.surface as string })),
    // source_opportunities exposes difficulty (0-100); approximate the source's
    // authority as its inverse so harder-to-win domains read as higher authority.
    citationGapDomains: (sourceOpps || []).map((s) => ({
      domain: s.source_domain as string,
      authority: typeof s.difficulty === "number" ? Math.round(s.difficulty) : undefined,
    })),
  };
}

export interface FastestPathResult {
  plan: FastestPathItem[];
  generatedAt: string;
}

export async function getFastestPath(
  supabase: SupabaseClient,
  projectId: string,
  limit = 8
): Promise<FastestPathResult> {
  const context = await buildFastestPathContext(supabase, projectId);
  const plan = computeFastestPath(context, { limit });
  return { plan, generatedAt: new Date().toISOString() };
}

/**
 * Auto-create "win this first" execution tasks from the top fastest-path items.
 * Additive + de-duplicated on (source_module, source_id) like the rest of the
 * execution-task pipeline.
 */
export async function syncFastestPathTasks(
  supabase: SupabaseClient,
  projectId: string,
  organizationId: string,
  topN = 5
): Promise<{ created: number; total: number }> {
  const { plan } = await getFastestPath(supabase, projectId, topN);
  if (plan.length === 0) return { created: 0, total: 0 };

  const { data: existing } = await supabase
    .from("execution_tasks")
    .select("source_module, source_id")
    .eq("project_id", projectId)
    .eq("source_module", "fastest_path");

  const existingKeys = new Set((existing || []).map((e) => `${e.source_id}`));

  const toInsert = plan
    .filter((item) => !existingKeys.has(item.id))
    .map((item) => ({
      project_id: projectId,
      organization_id: organizationId,
      title: `Win this first (#${item.rank}): ${item.title}`,
      description: `${item.rationale} ${item.why}`,
      source_module: "fastest_path" as const,
      source_id: item.id,
      category: item.type,
      priority: PRIORITY_FROM_SCORE(item.score),
      impact: item.impact,
      effort: EFFORT_HOURS[item.effort],
      status: "todo" as const,
    }));

  if (toInsert.length > 0) {
    await supabase.from("execution_tasks").insert(toInsert);
  }

  return { created: toInsert.length, total: plan.length };
}
