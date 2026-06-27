import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";

type ExportType =
  | "ranks"
  | "keywords"
  | "findings"
  | "ledger"
  | "visibility"
  | "backlinks"
  | "coverage"
  | "mentions"
  | "snippets"
  | "tasks"
  | "content_gaps"
  | "local";

interface ExportConfig {
  table: string;
  columns: string[];
  order?: { column: string; ascending: boolean };
}

// Raw-data export on every major dataset (CSV + JSON). Experts pull these into
// their own BigQuery/Looker — a tool you can't export from is a dead end to them.
const EXPORTS: Record<ExportType, ExportConfig> = {
  ranks: {
    table: "rank_keywords",
    columns: ["keyword", "location", "device", "target_url", "last_position", "share_of_voice", "is_striking_distance", "brand_in_ai_overview", "last_checked_at"],
    order: { column: "last_position", ascending: true },
  },
  keywords: {
    table: "keyword_opportunities",
    columns: [
      "keyword", "volume_estimate", "volume_range", "volume_confidence", "difficulty",
      "difficulty_method", "intent", "our_position", "opportunity_score", "data_source", "source",
    ],
    order: { column: "opportunity_score", ascending: false },
  },
  findings: {
    table: "technical_findings",
    columns: ["category", "severity", "title", "description", "fix_recommendation", "affected_url", "data_source", "is_resolved"],
  },
  ledger: {
    table: "results_ledger",
    columns: ["action_type", "action_surface", "description", "status", "executed_at", "verified_at"],
    order: { column: "executed_at", ascending: false },
  },
  visibility: {
    table: "visibility_results",
    columns: ["engine", "prompt_text", "brand_mentioned", "brand_cited", "source_domains", "cited_urls", "created_at"],
    order: { column: "created_at", ascending: false },
  },
  backlinks: {
    table: "backlink_snapshots",
    columns: ["total_count", "new_count", "lost_count", "created_at"],
    order: { column: "created_at", ascending: false },
  },
  coverage: {
    table: "coverage_items",
    columns: ["surface", "platform_name", "profile_url", "is_present", "is_optimized", "competitor_present", "notes"],
  },
  mentions: {
    table: "brand_mentions",
    columns: ["platform", "url", "title", "sentiment", "sentiment_score", "is_unlinked", "mention_type", "captured_at"],
    order: { column: "captured_at", ascending: false },
  },
  snippets: {
    table: "snippet_opportunities",
    columns: ["keyword", "feature", "current_position", "recommended_format", "owned", "last_checked_at"],
  },
  tasks: {
    table: "execution_tasks",
    columns: ["title", "category", "source_module", "priority", "impact", "effort", "status", "due_date"],
    order: { column: "impact", ascending: false },
  },
  content_gaps: {
    table: "content_gap_findings",
    columns: ["keyword", "competitor_domain", "competitor_position", "our_position", "opportunity_score", "status"],
    order: { column: "opportunity_score", ascending: false },
  },
  local: {
    table: "local_grid_scans",
    columns: ["keyword", "grid_size", "radius_km", "avg_rank", "found_cells", "total_cells", "created_at"],
    order: { column: "created_at", ascending: false },
  },
};

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.join(",");
  const body = rows.map((r) => columns.map((c) => escape(r[c])).join(",")).join("\n");
  return `${header}\n${body}`;
}

const TYPE_LIST = Object.keys(EXPORTS).join(", ");

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  const type = request.nextUrl.searchParams.get("type") as ExportType | null;
  const format = (request.nextUrl.searchParams.get("format") || "csv").toLowerCase();
  if (!projectId) return apiError("projectId required");
  if (!type || !(type in EXPORTS)) return apiError(`type must be one of: ${TYPE_LIST}`);

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const cfg = EXPORTS[type];
  let query = supabase.from(cfg.table).select(cfg.columns.join(",")).eq("project_id", projectId);
  if (cfg.order) query = query.order(cfg.order.column, { ascending: cfg.order.ascending, nullsFirst: false });

  const { data, error } = await query;
  if (error) return apiError(`Export failed: ${error.message}`, 500);

  const rows = (data || []) as unknown as Record<string, unknown>[];

  if (format === "json") {
    return new NextResponse(JSON.stringify({ type, count: rows.length, rows }, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${type}-${projectId}.json"`,
      },
    });
  }

  const csv = toCsv(rows, cfg.columns);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type}-${projectId}.csv"`,
    },
  });
}
