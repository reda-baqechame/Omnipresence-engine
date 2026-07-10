import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";
import { loadSearchOpsCommandCenter } from "@/lib/engines/searchops-command-center";
import {
  opportunitiesToCsv,
  opportunitiesToExportRows,
} from "@/lib/engines/searchops-export";

export const runtime = "nodejs";

/**
 * Export evidence-backed SearchOps opportunities (SSR snapshot path — no paid calls).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  const format = (request.nextUrl.searchParams.get("format") || "csv").toLowerCase();
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const center = await loadSearchOpsCommandCenter(supabase, project);
  const ops = center.opportunities;

  if (format === "json") {
    return new NextResponse(
      JSON.stringify(
        {
          projectId,
          count: ops.length,
          generatedAt: center.generatedAt,
          rows: opportunitiesToExportRows(ops),
          opportunities: ops,
        },
        null,
        2
      ),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="searchops-opportunities-${projectId}.json"`,
        },
      }
    );
  }

  const csv = opportunitiesToCsv(ops);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="searchops-opportunities-${projectId}.csv"`,
    },
  });
}
