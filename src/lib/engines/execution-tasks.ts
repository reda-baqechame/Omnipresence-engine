import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExecutionTaskSource,
  TaskPriority,
  FindingSeverity,
  RoadmapItem,
} from "@/types/database";

/**
 * Execution Task Engine (Phase 4).
 *
 * Bridges the diagnostic surfaces (technical findings, content/keyword gaps,
 * coverage gaps, authority opportunities, roadmap) into ONE tracked action model
 * with verified outcomes on re-scan. Sync is additive: it inserts newly-found
 * work but never clobbers a task a human has already moved/edited.
 */

interface TaskSeed {
  source_module: ExecutionTaskSource;
  source_id: string;
  title: string;
  description?: string;
  category?: string;
  priority: TaskPriority;
  impact: number;
  effort: number;
}

const SEVERITY_PRIORITY: Record<FindingSeverity, TaskPriority> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  info: "low",
};

const SEVERITY_IMPACT: Record<FindingSeverity, number> = {
  critical: 90,
  high: 70,
  medium: 45,
  low: 20,
  info: 10,
};

function scoreToPriority(score: number): TaskPriority {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function normalizeTitle(t: string): string {
  return t.replace(/^fix:\s*/i, "").trim().toLowerCase();
}

/**
 * Collect actionable seeds from every diagnostic surface, then insert any that
 * don't already exist (dedup on project_id + source_module + source_id).
 */
export async function syncExecutionTasks(
  supabase: SupabaseClient,
  projectId: string,
  organizationId: string
): Promise<{ created: number; total: number }> {
  const seeds: TaskSeed[] = [];

  const [findings, gaps, keywords, coverage, authority, roadmap, sourceOpps] = await Promise.all([
    supabase
      .from("technical_findings")
      .select("id, title, description, fix_recommendation, category, severity, is_resolved")
      .eq("project_id", projectId)
      .eq("is_resolved", false),
    supabase
      .from("content_gap_findings")
      .select("id, keyword, competitor_domain, opportunity_score, status")
      .eq("project_id", projectId)
      .eq("status", "open")
      .order("opportunity_score", { ascending: false })
      .limit(25),
    supabase
      .from("keyword_opportunities")
      .select("id, keyword, opportunity_score, intent, our_position, status")
      .eq("project_id", projectId)
      .order("opportunity_score", { ascending: false })
      .limit(25),
    supabase
      .from("coverage_items")
      .select("id, platform_name, surface, is_present, data_quality")
      .eq("project_id", projectId)
      .eq("is_present", false),
    supabase
      .from("authority_opportunities")
      .select("id, type, target_site, estimated_impact")
      .eq("project_id", projectId)
      .order("estimated_impact", { ascending: false })
      .limit(15),
    supabase
      .from("roadmaps")
      .select("id, items")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("source_opportunities")
      .select("id, source_domain, recommended_action, influence_score, difficulty, status")
      .eq("project_id", projectId)
      .eq("status", "open")
      .order("influence_score", { ascending: false })
      .limit(10),
  ]);

  for (const f of findings.data || []) {
    const sev = (f.severity as FindingSeverity) || "medium";
    seeds.push({
      source_module: "technical_finding",
      source_id: String(f.id),
      title: `Fix: ${f.title}`,
      description: f.fix_recommendation || f.description || undefined,
      category: f.category || "technical",
      priority: SEVERITY_PRIORITY[sev] || "medium",
      impact: SEVERITY_IMPACT[sev] ?? 45,
      effort: 2,
    });
  }

  for (const g of gaps.data || []) {
    const score = g.opportunity_score ?? 0;
    seeds.push({
      source_module: "content_gap",
      source_id: String(g.id),
      title: `Create content to win "${g.keyword}"`,
      description: `${g.competitor_domain} ranks for this and you don't. Build a stronger answer-first page.`,
      category: "content",
      priority: scoreToPriority(score),
      impact: score,
      effort: 4,
    });
  }

  for (const k of keywords.data || []) {
    const score = k.opportunity_score ?? 0;
    if (score < 30) continue;
    seeds.push({
      source_module: "keyword_opportunity",
      source_id: String(k.id),
      title: `Target keyword: ${k.keyword}`,
      description: `${k.intent || "informational"} intent${
        k.our_position ? ` · currently #${k.our_position}` : " · not ranking"
      }.`,
      category: "keywords",
      priority: scoreToPriority(score),
      impact: score,
      effort: 3,
    });
  }

  for (const c of coverage.data || []) {
    if (c.data_quality === "unavailable") continue; // unknown, not a confirmed gap
    seeds.push({
      source_module: "coverage_gap",
      source_id: String(c.id),
      title: `Establish presence on ${c.platform_name}`,
      description: `Create and optimize your ${c.surface} profile on ${c.platform_name}.`,
      category: c.surface || "coverage",
      priority: "medium",
      impact: 40,
      effort: 1,
    });
  }

  for (const a of authority.data || []) {
    const impact = a.estimated_impact ?? 30;
    seeds.push({
      source_module: "authority",
      source_id: String(a.id),
      title: `Authority: ${a.type} on ${a.target_site}`,
      description: `Pursue a ${a.type} placement on ${a.target_site}.`,
      category: "authority",
      priority: impact >= 60 ? "high" : "medium",
      impact,
      effort: 5,
    });
  }

  // "Win these sources" — top influence-ranked citation gaps become tracked
  // execution tasks (P2). Effort scales with how hard the source is to win.
  for (const s of sourceOpps.data || []) {
    const influence = s.influence_score ?? 0;
    if (influence < 25) continue;
    const difficulty = typeof s.difficulty === "number" ? s.difficulty : 50;
    seeds.push({
      source_module: "source_opportunity",
      source_id: String(s.id),
      title: `Win citation source: ${s.source_domain}`,
      description: s.recommended_action || `Earn a citation on ${s.source_domain} — it cites competitors but never you.`,
      category: "authority",
      priority: scoreToPriority(influence),
      impact: Math.round(influence),
      effort: difficulty >= 60 ? 5 : difficulty >= 40 ? 4 : 3,
    });
  }

  const roadmapItems = (roadmap.data?.items || []) as RoadmapItem[];
  roadmapItems.forEach((item, i) => {
    seeds.push({
      source_module: "roadmap",
      source_id: `${roadmap.data?.id}:${i}`,
      title: item.title,
      description: item.description,
      category: item.category,
      priority: item.impact,
      impact: item.impact === "critical" ? 80 : item.impact === "high" ? 60 : item.impact === "medium" ? 40 : 20,
      effort: item.estimated_hours ?? 2,
    });
  });

  if (seeds.length === 0) return { created: 0, total: 0 };

  // Only insert seeds that don't already exist for this project.
  const { data: existing } = await supabase
    .from("execution_tasks")
    .select("source_module, source_id")
    .eq("project_id", projectId);

  const existingKeys = new Set(
    (existing || []).map((e) => `${e.source_module}::${e.source_id}`)
  );

  const toInsert = seeds
    .filter((s) => !existingKeys.has(`${s.source_module}::${s.source_id}`))
    .map((s) => ({
      project_id: projectId,
      organization_id: organizationId,
      title: s.title,
      description: s.description ?? null,
      source_module: s.source_module,
      source_id: s.source_id,
      category: s.category ?? null,
      priority: s.priority,
      impact: s.impact,
      effort: s.effort,
      status: "todo" as const,
    }));

  if (toInsert.length > 0) {
    await supabase.from("execution_tasks").insert(toInsert);
  }

  return { created: toInsert.length, total: seeds.length };
}

/**
 * After a re-scan, verify which in-flight tasks resolved their underlying issue.
 *
 * Technical findings are wipe-and-replaced each scan (ids change), so we match by
 * normalized title: if a task's finding no longer appears as an unresolved finding
 * and the task was being worked, mark it verified with before/after score metrics.
 */
export async function verifyTaskResolution(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ verified: number }> {
  const { data: tasks } = await supabase
    .from("execution_tasks")
    .select("id, title, source_module, status")
    .eq("project_id", projectId)
    .in("status", ["in_progress", "done"]);

  if (!tasks || tasks.length === 0) return { verified: 0 };

  const { data: openFindings } = await supabase
    .from("technical_findings")
    .select("title")
    .eq("project_id", projectId)
    .eq("is_resolved", false);

  const openTitles = new Set((openFindings || []).map((f) => normalizeTitle(f.title)));

  const { data: scores } = await supabase
    .from("scores")
    .select("omnipresence_score, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(2);

  const after = scores?.[0]?.omnipresence_score ?? null;
  const before = scores?.[1]?.omnipresence_score ?? null;

  let verified = 0;
  const nowIso = new Date().toISOString();

  for (const t of tasks) {
    if (t.source_module !== "technical_finding") continue;
    const stillOpen = openTitles.has(normalizeTitle(t.title));
    if (!stillOpen) {
      await supabase
        .from("execution_tasks")
        .update({
          status: "verified",
          finding_resolved: true,
          verified_at: nowIso,
          before_metric: before != null ? { omnipresence_score: before } : null,
          after_metric: after != null ? { omnipresence_score: after } : null,
        })
        .eq("id", t.id);
      verified++;
    }
  }

  return { verified };
}
