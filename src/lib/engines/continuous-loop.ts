import type { SupabaseClient } from "@supabase/supabase-js";
import { syncExecutionTasks } from "@/lib/engines/execution-tasks";
import { findCitationGaps } from "@/lib/engines/citation-gap";

/**
 * Phase 22 — Onboarding, guarantee & continuous optimization loop.
 *
 * This module is the "operating system" that runs the 90-day playbook
 * automatically:
 *   1. buildOperatingPlan  — turns the onboarding objective/business-model intake
 *      into a persisted master competitor list + keyword universe + 90-day plan
 *      from REAL generated project data (refund-safe; no fabricated numbers).
 *   2. runCadenceReview    — daily/weekly/monthly/quarterly review that surfaces
 *      gainers/losers, decay, regressions and citation gaps, then materializes
 *      them as tracked execution tasks and stores a digest.
 *   3. gatherOperationalGuarantees — auto-verifies the things we actually promise
 *      (audit delivered, entity deployed, structural optimization shipped, GSC
 *      movement measured) so the guarantee/ledger can proof-report them.
 */

export type Cadence = "daily" | "weekly" | "monthly" | "quarterly";

export interface BusinessModel {
  offer?: string;
  conversion_goal?: string;
  aov?: number;
  ltv?: number;
  scope?: "local" | "national" | "global";
  monthly_ad_spend?: number;
}

export interface OperatingPlan {
  project_id: string;
  business_model: BusinessModel;
  competitor_universe: Array<{ name: string; domain?: string }>;
  keyword_universe: Array<{ keyword: string; opportunity_score?: number; intent?: string }>;
  plan: Array<{ week: number; title: string; description: string; impact: string; category: string }>;
  generated_at: string;
}

/**
 * Assemble (and persist) the operating plan from real, already-generated project
 * data: resolved competitors, scored keyword opportunities, and the latest
 * 90-day roadmap. Designed to run after the onboarding scan has populated these.
 */
export async function buildOperatingPlan(
  supabase: SupabaseClient,
  projectId: string,
  businessModel: BusinessModel
): Promise<OperatingPlan> {
  const [competitors, keywords, roadmap] = await Promise.all([
    supabase.from("competitors").select("name, domain").eq("project_id", projectId).limit(25),
    supabase
      .from("keyword_opportunities")
      .select("keyword, opportunity_score, intent")
      .eq("project_id", projectId)
      .order("opportunity_score", { ascending: false })
      .limit(200),
    supabase
      .from("roadmaps")
      .select("items")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const competitorRows = competitors.data || [];
  const competitorUniverse = competitorRows
    .filter((c) => c?.name || c?.domain)
    .map((c) => ({ name: c.name || c.domain || "", domain: c.domain || undefined }));

  const keywordUniverse = (keywords.data || []).map((k) => ({
    keyword: k.keyword,
    opportunity_score: k.opportunity_score ?? undefined,
    intent: k.intent ?? undefined,
  }));

  const planItems = ((roadmap.data?.items as OperatingPlan["plan"] | undefined) || []).map((i) => ({
    week: Number(i.week) || 1,
    title: String(i.title || ""),
    description: String(i.description || ""),
    impact: String(i.impact || "medium"),
    category: String(i.category || "general"),
  }));

  const generatedAt = new Date().toISOString();

  await supabase
    .from("operating_plans")
    .upsert(
      {
        project_id: projectId,
        business_model: businessModel,
        competitor_universe: competitorUniverse,
        keyword_universe: keywordUniverse,
        plan: planItems,
        generated_at: generatedAt,
      },
      { onConflict: "project_id" }
    )
    .select()
    .maybeSingle();

  return {
    project_id: projectId,
    business_model: businessModel,
    competitor_universe: competitorUniverse,
    keyword_universe: keywordUniverse,
    plan: planItems,
    generated_at: generatedAt,
  };
}

export interface CadenceDigest {
  cadence: Cadence;
  window_days: number;
  gainers: Array<{ keyword: string; from: number | null; to: number | null; delta: number }>;
  losers: Array<{ keyword: string; from: number | null; to: number | null; delta: number }>;
  striking_distance: number;
  rank_alerts: number;
  technical_regressions: number;
  citation_gaps: number;
  tasks_created: number;
  generated_at: string;
}

const CADENCE_WINDOW: Record<Cadence, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  quarterly: 90,
};

function pos(n: number | null | undefined): number {
  // Treat "not ranking" as position 101 so deltas are comparable/sortable.
  return n == null ? 101 : Number(n);
}

/**
 * Run a cadence review: compute movement from real rank snapshots, count
 * technical regressions and citation gaps, materialize execution tasks, and
 * persist a digest. Safe to run with partial data (graceful fallbacks).
 */
export async function runCadenceReview(
  supabase: SupabaseClient,
  projectId: string,
  organizationId: string,
  cadence: Cadence
): Promise<CadenceDigest> {
  const windowDays = CADENCE_WINDOW[cadence];
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  // --- Movement: compare first vs last snapshot per keyword in the window. ---
  const [{ data: snapshots }, { data: rankKeywords }] = await Promise.all([
    supabase
      .from("rank_snapshots")
      .select("keyword_id, position, checked_at")
      .eq("project_id", projectId)
      .gte("checked_at", since)
      .order("checked_at", { ascending: true }),
    supabase.from("rank_keywords").select("id, keyword").eq("project_id", projectId),
  ]);

  const keywordById = new Map<string, string>();
  for (const k of rankKeywords || []) keywordById.set(k.id, k.keyword);

  const firstByKw = new Map<string, number | null>();
  const lastByKw = new Map<string, number | null>();
  for (const s of snapshots || []) {
    const keyword = keywordById.get(s.keyword_id);
    if (!keyword) continue;
    if (!firstByKw.has(keyword)) firstByKw.set(keyword, s.position);
    lastByKw.set(keyword, s.position);
  }

  const movements: Array<{ keyword: string; from: number | null; to: number | null; delta: number }> = [];
  for (const [keyword, from] of firstByKw) {
    const to = lastByKw.get(keyword) ?? null;
    // Improvement = ranking moved toward 1 (lower number), so delta = from - to.
    const delta = pos(from) - pos(to);
    if (delta !== 0) movements.push({ keyword, from, to, delta });
  }
  const gainers = movements.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 10);
  const losers = movements.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 10);

  // --- Striking distance + rank alerts in window. ---
  const [{ count: strikingCount }, { count: alertCount }] = await Promise.all([
    supabase
      .from("rank_keywords")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("is_striking_distance", true),
    supabase
      .from("rank_alerts")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .gte("created_at", since),
  ]);

  // --- Technical regressions from the latest finding diff snapshot. ---
  let technicalRegressions = 0;
  const { data: lastSnap } = await supabase
    .from("finding_snapshots")
    .select("regressed_count")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastSnap) {
    technicalRegressions = Number(lastSnap.regressed_count) || 0;
  }

  // --- Citation gaps (domains citing competitors but not us). ---
  let citationGaps = 0;
  try {
    const gapResult = await findCitationGaps(supabase, projectId);
    citationGaps = gapResult.available ? gapResult.gaps.length : 0;
  } catch {
    citationGaps = 0;
  }

  // --- Materialize every open diagnostic into a tracked execution task. ---
  let tasksCreated = 0;
  try {
    const res = await syncExecutionTasks(supabase, projectId, organizationId);
    tasksCreated = res.created;
  } catch {
    tasksCreated = 0;
  }

  const digest: CadenceDigest = {
    cadence,
    window_days: windowDays,
    gainers,
    losers,
    striking_distance: strikingCount ?? 0,
    rank_alerts: alertCount ?? 0,
    technical_regressions: technicalRegressions,
    citation_gaps: citationGaps,
    tasks_created: tasksCreated,
    generated_at: new Date().toISOString(),
  };

  await supabase.from("operating_reviews").insert({
    project_id: projectId,
    cadence,
    digest,
    tasks_created: tasksCreated,
  });

  return digest;
}

export interface OperationalGuarantee {
  id: string;
  name: string;
  met: boolean;
  evidence: string;
}

/**
 * Auto-verify the operational guarantees we actually promise (controllable
 * deliverables), each backed by a real, queryable evidence source. Never
 * guarantees rankings or "appear everywhere in AI" — only what we can prove.
 */
export async function gatherOperationalGuarantees(
  supabase: SupabaseClient,
  projectId: string
): Promise<OperationalGuarantee[]> {
  const [scores, entity, ledger, gscConn] = await Promise.all([
    supabase
      .from("scores")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    supabase
      .from("entity_profiles")
      .select("entity_score, same_as_map, knowledge_panel_ready")
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("results_ledger")
      .select("id, action_surface, status")
      .eq("project_id", projectId)
      .in("status", ["completed", "verified"]),
    supabase
      .from("oauth_connections")
      .select("id")
      .eq("project_id", projectId)
      .eq("provider", "google_search_console")
      .maybeSingle(),
  ]);

  const scoreCount = scores.count ?? 0;
  const entityRow = entity.data as { entity_score?: number; same_as_map?: Record<string, unknown> } | null;
  const entityScore = Number(entityRow?.entity_score ?? 0);
  const sameAsMap = entityRow?.same_as_map;
  const sameAsCount = sameAsMap && typeof sameAsMap === "object" ? Object.keys(sameAsMap).length : 0;
  const ledgerRows = ledger.data || [];
  const structuralShipped = ledgerRows.filter((r) =>
    ["content", "schema", "structural", "on_page", "visibility"].includes(String(r.action_surface))
  ).length;
  const gscConnected = Boolean(gscConn.data);

  return [
    {
      id: "audit_delivered",
      name: "Full OmniPresence audit delivered",
      met: scoreCount > 0,
      evidence: scoreCount > 0 ? `${scoreCount} scored scan(s) on record` : "No completed scan yet",
    },
    {
      id: "entity_deployed",
      name: "Entity / sameAs identity deployed",
      met: entityScore > 0 || sameAsCount > 0,
      evidence:
        entityScore > 0 || sameAsCount > 0
          ? `entity score ${entityScore}, ${sameAsCount} sameAs link(s)`
          : "No entity profile / sameAs links yet",
    },
    {
      id: "structural_optimization_shipped",
      name: "Structural optimization shipped",
      met: structuralShipped > 0,
      evidence:
        structuralShipped > 0
          ? `${structuralShipped} completed structural/content action(s)`
          : "No completed structural actions yet",
    },
    {
      id: "gsc_movement_measured",
      name: "Search-engine movement measurable (GSC)",
      met: gscConnected && scoreCount >= 2,
      evidence: gscConnected
        ? scoreCount >= 2
          ? "GSC connected + multiple score snapshots (movement measurable)"
          : "GSC connected; need a second snapshot to measure movement"
        : "Connect Google Search Console to measure movement",
    },
  ];
}
