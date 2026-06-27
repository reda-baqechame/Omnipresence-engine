import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateApiKey } from "@/lib/security/api-keys";
import { triggerProjectScan } from "@/lib/engines/trigger-scan";

/**
 * Public API (Phase 11): batch-trigger scans for projects owned by the key's org.
 * Body: { projectIds: string[] }  (or { all: true } to scan every active project)
 */
export async function POST(request: NextRequest) {
  const supabase = await createServiceClient();
  const ctx = await authenticateApiKey(supabase, request);
  if (!ctx) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const all = body.all === true;
  const requestedIds: string[] = Array.isArray(body.projectIds) ? body.projectIds : [];

  let query = supabase
    .from("projects")
    .select("id")
    .eq("organization_id", ctx.organizationId);

  if (!all) {
    if (requestedIds.length === 0) {
      return NextResponse.json({ error: "projectIds required (or all:true)" }, { status: 400 });
    }
    query = query.in("id", requestedIds.slice(0, 50));
  }

  const { data: projects } = await query;
  if (!projects || projects.length === 0) {
    return NextResponse.json({ error: "No matching projects for this key" }, { status: 404 });
  }

  const triggered: string[] = [];
  for (const p of projects) {
    await triggerProjectScan(p.id, ctx.organizationId);
    triggered.push(p.id);
  }

  return NextResponse.json({ triggered, count: triggered.length });
}
