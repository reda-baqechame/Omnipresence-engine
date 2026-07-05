import type { ExecutionTask, TaskPriority } from "@/types/database";

/**
 * Action Plan engine — answers "what do I do Monday morning?".
 *
 * The Kanban (Execution Tasks) shows everything; this ranks the OPEN work by
 * return-on-effort (impact per hour, weighted by priority) and returns a short,
 * sequenced shortlist plus the single highest-leverage move. This is the
 * execution layer that turns diagnostics into a prioritized plan.
 */

export interface ActionItem {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  priority: TaskPriority;
  impact: number;
  effort: number;
  roi: number;
  surface: string;
  href: string | null;
  /** Measured finding this action addresses (Peec Actions style). */
  evidenceCitation?: string | null;
  ownedEarned?: "owned" | "earned" | "unknown";
}

export interface ActionPlan {
  thisWeek: ActionItem[];
  topMove: ActionItem | null;
  remaining: number;
  totalEffort: number;
}

const PRIORITY_MULT: Record<TaskPriority, number> = {
  critical: 1.5,
  high: 1.25,
  medium: 1.0,
  low: 0.8,
};

const OPEN_STATUSES = new Set(["todo", "in_progress", "blocked"]);

const GENERIC_FASTEST_PATH = new Set(["reddit_quora", "directory", "review_site"]);

function isEvidenceBackedTask(task: ExecutionTask): boolean {
  if (task.source_module === "fastest_path" && task.category && GENERIC_FASTEST_PATH.has(task.category)) {
    return false;
  }
  if (task.source_module === "coverage_gap" && /reddit|quora|facebook|instagram|tiktok/i.test(task.title)) {
    return false;
  }
  return true;
}

/** Human label + the in-app surface where this action is executed. */
export function actionSurface(
  projectId: string,
  task: Pick<ExecutionTask, "source_module" | "category">
): { surface: string; href: string | null } {
  const base = `/app/projects/${projectId}`;
  const cat = (task.category || "").toLowerCase();
  switch (task.source_module) {
    case "content_gap":
      return { surface: "Content", href: `${base}/content` };
    case "keyword_opportunity":
      return { surface: "Keywords", href: `${base}/keywords` };
    case "coverage_gap":
      return { surface: "Coverage", href: `${base}/coverage` };
    case "authority":
      return { surface: "Authority", href: `${base}/authority` };
    case "technical_finding":
      if (cat.includes("schema") || cat.includes("entity")) return { surface: "Entity", href: `${base}/entity` };
      if (cat.includes("content")) return { surface: "Content", href: `${base}/content` };
      return { surface: "Technical", href: `${base}/technical` };
    case "roadmap":
      if (cat.includes("content")) return { surface: "Content", href: `${base}/content` };
      if (cat.includes("local") || cat.includes("directory") || cat.includes("social"))
        return { surface: "Coverage", href: `${base}/coverage` };
      if (cat.includes("authority")) return { surface: "Authority", href: `${base}/authority` };
      return { surface: "Roadmap", href: `${base}/roadmap` };
    default:
      return { surface: "Tasks", href: `${base}/tasks` };
  }
}

/** Return-on-effort score: impact per hour, weighted by priority. */
function roiScore(task: Pick<ExecutionTask, "impact" | "effort" | "priority">): number {
  const impact = Number(task.impact) || 0;
  const effort = Math.max(1, Number(task.effort) || 1);
  const mult = PRIORITY_MULT[task.priority] ?? 1;
  return (impact / effort) * mult;
}

export function buildActionPlan(projectId: string, tasks: ExecutionTask[], limit = 6): ActionPlan {
  const open = tasks.filter((t) => OPEN_STATUSES.has(t.status) && isEvidenceBackedTask(t));

  const ranked: ActionItem[] = open
    .map((t) => {
      const { surface, href } = actionSurface(projectId, t);
      const meta = (t.evidence || {}) as Record<string, unknown>;
      const evidenceCitation =
        (typeof meta.evidence_excerpt === "string" && meta.evidence_excerpt) ||
        (typeof meta.finding === "string" && meta.finding) ||
        t.description;
      const ownedEarned: ActionItem["ownedEarned"] =
        t.source_module === "authority" || t.source_module === "coverage_gap"
          ? "earned"
          : t.source_module === "technical_finding" || t.source_module === "content_gap"
            ? "owned"
            : "unknown";
      return {
        id: t.id,
        title: t.title,
        description: t.description ?? null,
        category: t.category ?? null,
        priority: t.priority,
        impact: Number(t.impact) || 0,
        effort: Math.max(1, Number(t.effort) || 1),
        roi: roiScore(t),
        surface,
        href,
        evidenceCitation,
        ownedEarned,
      };
    })
    .sort((a, b) => b.roi - a.roi);

  const thisWeek = ranked.slice(0, limit);
  return {
    thisWeek,
    topMove: thisWeek[0] ?? null,
    remaining: Math.max(0, ranked.length - thisWeek.length),
    totalEffort: thisWeek.reduce((s, a) => s + a.effort, 0),
  };
}
