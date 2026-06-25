import type { SupabaseClient } from "@supabase/supabase-js";
import type { TechnicalAuditFinding } from "@/lib/engines/technical-audit";

const ON_PAGE_CATEGORIES: Record<string, string> = {
  title_tags: "on_page_title",
  meta_description: "on_page_meta",
  schema_markup: "schema_fix",
  structured_data: "schema_fix",
  internal_linking: "internal_link",
  crawl_coverage: "technical_crawl",
  duplicate_content: "content_consolidate",
  freshness: "content_refresh",
  ai_crawlability: "robots_fix",
  robots: "robots_fix",
  sitemap: "sitemap_fix",
  canonical: "canonical_fix",
  indexability: "indexability_fix",
};

function actionTitle(finding: TechnicalAuditFinding): string {
  return `Fix: ${finding.title}`;
}

function riskLevel(severity: TechnicalAuditFinding["severity"]): "low" | "medium" | "high" {
  if (severity === "critical") return "high";
  if (severity === "high") return "high";
  if (severity === "medium") return "medium";
  return "low";
}

/**
 * Push technical audit findings into the ops queue for human-approved execution.
 */
export async function syncTechnicalFindingsToOpsQueue(
  supabase: SupabaseClient,
  projectId: string,
  organizationId: string,
  findings: TechnicalAuditFinding[]
): Promise<number> {
  const actionable = findings.filter(
    (f) => f.severity === "critical" || f.severity === "high" || f.severity === "medium"
  );

  if (!actionable.length) return 0;

  const rows = actionable.map((f) => ({
    project_id: projectId,
    organization_id: organizationId,
    action_type: ON_PAGE_CATEGORIES[f.category] || "on_page_fix",
    title: actionTitle(f),
    payload: {
      category: f.category,
      severity: f.severity,
      description: f.description,
      impact: f.impact,
      fix_recommendation: f.fix_recommendation,
      affected_url: f.affected_url,
    },
    risk_level: riskLevel(f.severity),
    status: f.severity === "critical" ? "approved" : "pending",
    sla_due_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  }));

  const { data: existing } = await supabase
    .from("ops_queue")
    .select("title")
    .eq("project_id", projectId)
    .in("status", ["pending", "approved", "executing"]);

  const existingTitles = new Set((existing || []).map((r) => r.title));
  const toInsert = rows.filter((r) => !existingTitles.has(r.title));
  if (!toInsert.length) return 0;

  const { error } = await supabase.from("ops_queue").insert(toInsert);
  if (error) return 0;

  return toInsert.length;
}

export async function syncOnPageQueueForProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<number> {
  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .single();
  if (!project) return 0;

  const { data: findings } = await supabase
    .from("technical_findings")
    .select("*")
    .eq("project_id", projectId)
    .eq("is_resolved", false);

  if (!findings?.length) return 0;

  return syncTechnicalFindingsToOpsQueue(
    supabase,
    projectId,
    project.organization_id,
    findings as TechnicalAuditFinding[]
  );
}
