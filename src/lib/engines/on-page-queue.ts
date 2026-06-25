import type { SupabaseClient } from "@supabase/supabase-js";
import type { TechnicalAuditFinding } from "@/lib/engines/technical-audit";
import { runOnPageAgents, type OnPageFixProposal } from "@/lib/engines/on-page-agents";
import { labsApiPost } from "@/lib/providers/dataforseo";
import { assertPublicDomain } from "@/lib/security/domain";

const OMNIDATA_URL = process.env.OMNIDATA_BASE_URL?.replace(/\/$/, "");

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

async function fetchInstantPageLocal(url: string) {
  try {
    const host = new URL(url).hostname;
    assertPublicDomain(host);
    const res = await fetch(url, {
      headers: { "User-Agent": "PresenceOS-OnPage/1.0" },
      signal: AbortSignal.timeout(12000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    const meta =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1];
    const h1 = html.match(/<h1[^>]*>([^<]*)<\/h1>/i)?.[1]?.trim();
    const schemaTypes = [...new Set([...html.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1]))];
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ");
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)];
    const imagesWithoutAlt = imgTags.filter((m) => !/\balt\s*=\s*["'][^"']+["']/i.test(m[0])).length;

    return {
      url,
      title,
      meta_description: meta,
      h1,
      schema_types: schemaTypes,
      word_count: wordCount,
      images_without_alt: imagesWithoutAlt,
    };
  } catch {
    return null;
  }
}

async function fetchInstantPage(url: string) {
  if (OMNIDATA_URL) {
    const data = await labsApiPost<{
      tasks?: Array<{ result?: Array<Record<string, unknown>> }>;
    }>("/on_page/instant_pages", [{ url }]);
    const page = data?.tasks?.[0]?.result?.[0] as {
      url: string;
      title?: string;
      meta_description?: string;
      h1?: string;
      schema_types?: string[];
      word_count?: number;
      images_without_alt?: number;
    } | undefined;
    if (page) return page;
  }
  return fetchInstantPageLocal(url);
}

/** Daily on-page scan: run 6 agents on homepage + top pages, queue fixes in ops_queue. */
export async function runDailyOnPageAutomation(
  supabase: SupabaseClient,
  projectId: string,
  domain: string,
  brandName: string
): Promise<number> {
  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .single();
  if (!project) return 0;

  const urls = [`https://${domain.replace(/^https?:\/\//, "")}`, `https://${domain}/about`];
  const allFixes: OnPageFixProposal[] = [];

  for (const url of urls) {
    const page = await fetchInstantPage(url);
    if (!page) continue;
    allFixes.push(
      ...runOnPageAgents(
        {
          url: page.url,
          title: page.title,
          meta_description: page.meta_description,
          h1: page.h1,
          schema_types: page.schema_types || [],
          word_count: page.word_count || 0,
          images_without_alt: page.images_without_alt,
          year_in_title: Boolean(page.title && /\b20(1[0-9]|2[0-4])\b/.test(page.title)),
        },
        brandName
      )
    );
  }

  if (!allFixes.length) return 0;

  const rows = allFixes.map((f) => ({
    project_id: projectId,
    organization_id: project.organization_id,
    action_type: `on_page_${f.agent}`,
    title: `[${f.agent}] ${f.field} — ${new URL(f.url).pathname}`,
    payload: {
      agent: f.agent,
      url: f.url,
      field: f.field,
      current: f.current,
      proposed: f.proposed,
      confidence: f.confidence,
      rationale: f.rationale,
    },
    risk_level: f.confidence >= 85 ? "low" : "medium",
    status: f.confidence >= 90 ? "approved" : "pending",
    sla_due_at: new Date(Date.now() + 3 * 86400000).toISOString(),
  }));

  const { error } = await supabase.from("ops_queue").insert(rows);
  return error ? 0 : rows.length;
}
