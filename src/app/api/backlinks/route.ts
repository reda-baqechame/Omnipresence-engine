import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  snapshotProjectBacklinks,
  getLatestBacklinkDiff,
} from "@/lib/engines/backlink-monitor";
import { analyzeAuthorityDistribution } from "@/lib/engines/link-intelligence";
import { getWebgraphStatus } from "@/lib/providers/webgraph";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { BacklinksQuerySchema } from "@/lib/validation/schemas";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const diff = await getLatestBacklinkDiff(supabase, projectId);
  const { data: latest } = await supabase
    .from("backlink_snapshots")
    .select("total_count, new_count, lost_count, created_at, backlinks")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const rows = ((latest?.backlinks as Array<{ rank?: number }> | null) || [])
    .filter((b) => typeof b.rank === "number")
    .map((b) => ({ rank: b.rank as number }));
  const authority = rows.length ? analyzeAuthorityDistribution(rows) : null;
  const webgraph = await getWebgraphStatus();

  return NextResponse.json({
    latest: latest
      ? {
          total_count: latest.total_count,
          new_count: latest.new_count,
          lost_count: latest.lost_count,
          created_at: latest.created_at,
        }
      : null,
    diff,
    authority: webgraph.ready ? authority : null,
    webgraph: {
      ready: webgraph.ready,
      available: webgraph.available,
      ingestInProgress: webgraph.ingestInProgress,
      edgeCount: webgraph.edgeCount,
    },
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(request, BacklinksQuerySchema);
  if (parsed.response) return parsed.response;
  const body = parsed.data;
  const { domain } = body;

  const { data: project } = await supabase
    .from("projects")
    .select("id, domain")
    .eq("domain", domain)
    .single();
  if (!project) return apiError("Project not found", 404);

  const access = await verifyProjectAccess(supabase, project.id, user.id, "member");
  if (!access) return apiForbidden();

  const result = await snapshotProjectBacklinks(supabase, project.id, project.domain);
  return NextResponse.json(result);
}
