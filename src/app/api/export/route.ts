import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";
import { EXPORTS, EXPORT_TYPES, toCsv, type ExportType } from "@/lib/export/datasets";

const TYPE_LIST = EXPORT_TYPES.join(", ");

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
