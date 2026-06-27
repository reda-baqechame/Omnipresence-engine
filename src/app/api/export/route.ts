import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";

type ExportType = "ranks" | "keywords" | "findings" | "ledger";

const EXPORTS: Record<
  ExportType,
  { table: string; columns: string[]; order?: { column: string; ascending: boolean } }
> = {
  ranks: {
    table: "rank_keywords",
    columns: ["keyword", "location", "target_url", "last_position", "is_striking_distance", "last_checked_at"],
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
    columns: ["category", "severity", "title", "description", "fix_recommendation", "affected_url", "is_resolved"],
  },
  ledger: {
    table: "results_ledger",
    columns: ["action_type", "action_surface", "description", "status", "executed_at", "verified_at"],
    order: { column: "executed_at", ascending: false },
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

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  const type = request.nextUrl.searchParams.get("type") as ExportType | null;
  if (!projectId) return apiError("projectId required");
  if (!type || !(type in EXPORTS)) return apiError("type must be one of: ranks, keywords, findings, ledger");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const cfg = EXPORTS[type];
  let query = supabase.from(cfg.table).select(cfg.columns.join(",")).eq("project_id", projectId);
  if (cfg.order) query = query.order(cfg.order.column, { ascending: cfg.order.ascending, nullsFirst: false });

  const { data, error } = await query;
  if (error) return apiError(`Export failed: ${error.message}`, 500);

  const csv = toCsv((data || []) as unknown as Record<string, unknown>[], cfg.columns);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type}-${projectId}.csv"`,
    },
  });
}
