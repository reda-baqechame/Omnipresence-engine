import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { getCruxHistory } from "@/lib/providers/crux-history";
import { recordMeasurementEvidence } from "@/lib/engines/evidence";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data } = await supabase
    .from("cwv_history")
    .select("collected_on, lcp_ms, inp_ms, cls")
    .eq("project_id", projectId)
    .order("collected_on");

  return NextResponse.json({ history: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  let body: { projectId?: string };
  try {
    body = await readJsonBody(request);
  } catch {
    return apiError("Invalid JSON body");
  }
  const { projectId } = body;
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase.from("projects").select("domain").eq("id", projectId).single();
  if (!project) return apiError("Project not found", 404);

  const res = await getCruxHistory(project.domain);
  if (!res.available) {
    return NextResponse.json({ available: false, reason: res.reason, history: [] });
  }

  if (res.points.length) {
    await supabase.from("cwv_history").upsert(
      res.points.map((p) => ({
        project_id: projectId,
        collected_on: p.date,
        lcp_ms: p.lcpMs ?? null,
        inp_ms: p.inpMs ?? null,
        cls: p.cls ?? null,
        data_source: "measured",
      })),
      { onConflict: "project_id,collected_on" }
    );

    // First-class evidence: real-user CrUX field data is a measured signal.
    const latest = res.points[res.points.length - 1];
    await recordMeasurementEvidence(supabase, {
      projectId,
      capability: "pagespeed",
      target: project.domain,
      provider: "crux",
      sourceUrl: `https://${project.domain}`,
      parserVersion: "crux-history@1",
      dataSource: "measured",
      rawPayload: res.points,
      excerpt: { latest_date: latest?.date, lcp_ms: latest?.lcpMs, inp_ms: latest?.inpMs, cls: latest?.cls, points: res.points.length },
    }).catch(() => {});
  }

  return NextResponse.json({ available: true, history: res.points.map((p) => ({ collected_on: p.date, lcp_ms: p.lcpMs, inp_ms: p.inpMs, cls: p.cls })) });
}
