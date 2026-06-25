import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseMentionsCsv, summarizeMentions } from "@/lib/engines/community-mentions";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("name, competitors")
    .eq("id", projectId)
    .single();

  const { data } = await supabase
    .from("community_mentions")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const summary = summarizeMentions(
    (data || []).map((r) => ({
      platform: r.platform as "reddit" | "quora" | "other",
      url: r.url,
      keyword: r.keyword,
    })),
    project?.name || "",
    (project?.competitors || []) as string[]
  );

  return NextResponse.json({ mentions: data || [], summary });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId, csv } = await request.json() as { projectId: string; csv: string };
  if (!projectId || !csv) return apiError("projectId and csv required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const rows = parseMentionsCsv(csv);
  if (rows.length) {
    await supabase.from("community_mentions").insert(
      rows.map((r) => ({
        project_id: projectId,
        platform: r.platform,
        url: r.url,
        keyword: r.keyword,
        mention_type: r.mention_type || "brand",
      }))
    );
  }

  return NextResponse.json({ imported: rows.length });
}
