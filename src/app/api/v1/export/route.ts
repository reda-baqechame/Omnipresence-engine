import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateApiKey } from "@/lib/security/api-keys";
import { EXPORTS, EXPORT_TYPES, toCsv, type ExportType } from "@/lib/export/datasets";
import { guardApiKeyEndpoint } from "@/lib/security/api-v1-guard";

/**
 * Public, API-key-authenticated export (Phase 16). Powers the Looker Studio
 * community connector, Google Sheets / Metabase pulls, and scheduled exports.
 * Auth via `x-api-key` or `Authorization: Bearer omp_...`. Returns JSON
 * (default) or CSV (`?format=csv`).
 */
export async function GET(request: NextRequest) {
  const supabase = await createServiceClient();
  const ctx = await authenticateApiKey(supabase, request);
  if (!ctx) return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });

  const limited = await guardApiKeyEndpoint(request, ctx.organizationId, "export", 60, 60 * 60 * 1000);
  if (limited) return limited;

  const projectId = request.nextUrl.searchParams.get("projectId");
  const type = request.nextUrl.searchParams.get("type") as ExportType | null;
  const format = (request.nextUrl.searchParams.get("format") || "json").toLowerCase();
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  if (!type || !(type in EXPORTS)) {
    return NextResponse.json({ error: `type must be one of: ${EXPORT_TYPES.join(", ")}`, types: EXPORT_TYPES }, { status: 400 });
  }

  // Scope: project must belong to the key's organization.
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found for this key" }, { status: 404 });

  const cfg = EXPORTS[type];
  let query = supabase.from(cfg.table).select(cfg.columns.join(",")).eq("project_id", projectId);
  if (cfg.order) query = query.order(cfg.order.column, { ascending: cfg.order.ascending, nullsFirst: false });

  const { data, error } = await query.limit(5000);
  if (error) return NextResponse.json({ error: `Export failed: ${error.message}` }, { status: 500 });

  const rows = (data || []) as unknown as Record<string, unknown>[];

  if (format === "csv") {
    return new NextResponse(toCsv(rows, cfg.columns), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${type}-${projectId}.csv"`,
      },
    });
  }

  return NextResponse.json({ type, schema: cfg.columns, count: rows.length, rows });
}
