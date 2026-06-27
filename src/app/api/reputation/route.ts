import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";
import {
  monitorBrandMentions,
  analyzeAiBrandSentiment,
  auditBrandSerp,
} from "@/lib/engines/reputation";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data } = await supabase
    .from("brand_mentions")
    .select("platform, url, title, sentiment, is_unlinked, mention_type, captured_at")
    .eq("project_id", projectId)
    .order("captured_at", { ascending: false })
    .limit(100);

  return NextResponse.json({ mentions: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await request.json();
  const { projectId, action } = body as {
    projectId: string;
    action: "monitor" | "ai_sentiment" | "brand_serp";
  };
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("name, domain, industry, competitors")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const brand = project.name || project.domain;
  const competitors = (project.competitors || []) as string[];

  if (action === "monitor") {
    return NextResponse.json(
      await monitorBrandMentions(supabase, { projectId, brand, domain: project.domain, competitors })
    );
  }
  if (action === "ai_sentiment") {
    return NextResponse.json(
      await analyzeAiBrandSentiment({ brand, domain: project.domain, industry: project.industry || undefined })
    );
  }
  if (action === "brand_serp") {
    return NextResponse.json(await auditBrandSerp(brand, project.domain));
  }

  return apiError("Unknown action");
}
