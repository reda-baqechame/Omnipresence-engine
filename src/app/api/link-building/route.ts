import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildMonthlyCampaign } from "@/lib/engines/link-building";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { LinkBuildingPatchSchema, LinkBuildingPostSchema } from "@/lib/validation/schemas";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data } = await supabase
    .from("link_building_orders")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  return NextResponse.json({ orders: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const v = await validateBody(request, LinkBuildingPostSchema);
  if (v.response) return v.response;
  const { projectId, tier } = v.data;

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("name, domain, competitors")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const { data: keywords } = await supabase
    .from("keyword_opportunities")
    .select("keyword")
    .eq("project_id", projectId)
    .order("opportunity_score", { ascending: false })
    .limit(10);

  const { data: snapshot } = await supabase
    .from("backlink_snapshots")
    .select("backlinks")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const backlinkList = (snapshot?.backlinks || []) as Array<{ domain?: string; rank?: number }>;
  const gapDomains = backlinkList.slice(0, 20).map((b) => ({
    domain: (b.domain || "").replace(/^www\./, ""),
    dr_estimate: b.rank ?? 35,
  }));

  const orders = buildMonthlyCampaign(
    project.name,
    project.domain,
    (keywords || []).map((k) => k.keyword),
    gapDomains.length ? gapDomains : [{ domain: "industry-blog.com", dr_estimate: 40 }],
    tier || "growth"
  );

  if (orders.length) {
    await supabase.from("link_building_orders").insert(
      orders.map((o) => ({
        project_id: projectId,
        target_url: o.target_url,
        anchor_text: o.anchor_text,
        anchor_type: o.anchor_type,
        vendor_tier: o.vendor_tier,
        estimated_dr: o.estimated_dr,
        status: o.status,
      }))
    );
  }

  return NextResponse.json({ orders, count: orders.length });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const v = await validateBody(request, LinkBuildingPatchSchema);
  if (v.response) return v.response;
  const { id, status } = v.data;

  const { data: row } = await supabase
    .from("link_building_orders")
    .select("project_id")
    .eq("id", id)
    .single();
  if (!row) return apiError("Not found", 404);

  const access = await verifyProjectAccess(supabase, row.project_id, user.id, "member");
  if (!access) return apiForbidden();

  await supabase.from("link_building_orders").update({ status }).eq("id", id);
  return NextResponse.json({ ok: true });
}
