import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import {
  buildSourceGraph,
  getSourceGraph,
  getSourceOpportunities,
  getSourceNeighbors,
  getPathToCitation,
} from "@/lib/engines/source-graph";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const [graph, opportunities] = await Promise.all([
    getSourceGraph(projectId),
    getSourceOpportunities(projectId),
  ]);
  return NextResponse.json({ graph, opportunities });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await readJsonBody(request);
  const { projectId, action, domain, prompt } = body as {
    projectId: string;
    action: "build" | "neighbors" | "path";
    domain?: string;
    prompt?: string;
  };
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  if (action === "build") {
    const result = await buildSourceGraph(projectId);
    return NextResponse.json(result);
  }
  if (action === "neighbors") {
    if (!domain) return apiError("domain required for neighbors");
    const result = await getSourceNeighbors(projectId, domain);
    return NextResponse.json(result);
  }
  if (action === "path") {
    if (!prompt) return apiError("prompt required for path");
    const result = await getPathToCitation(projectId, prompt);
    return NextResponse.json(result);
  }

  return apiError("Unknown action");
}
