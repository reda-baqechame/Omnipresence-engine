import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchHackerNews } from "@/lib/providers/hacker-news";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";

/**
 * Live community-mention discovery via the free Hacker News (Algolia) API.
 * Complements the CSV importer with real, time-stamped mentions and persists
 * them into the existing community_mentions table (platform "other").
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId, sinceDays } = (await request.json()) as {
    projectId: string;
    sinceDays?: number;
  };
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("name, competitors")
    .eq("id", projectId)
    .single();
  if (!project?.name) return apiError("Project not found", 404);

  const window = Math.min(Math.max(sinceDays ?? 365, 1), 1825);
  const competitors = (project.competitors || []) as string[];

  const queries: Array<{ term: string; type: "brand" | "competitor"; competitor?: string }> = [
    { term: project.name, type: "brand" },
    ...competitors.map((c) => ({ term: c, type: "competitor" as const, competitor: c })),
  ];

  const rows: Array<{
    project_id: string;
    platform: string;
    url: string;
    keyword: string;
    mention_type: string;
    competitor: string | null;
  }> = [];
  const seen = new Set<string>();

  for (const q of queries) {
    const res = await searchHackerNews(q.term, { sinceDays: window, limit: 25 });
    if (!res.success || !res.data) continue;
    for (const m of res.data) {
      if (seen.has(m.permalink)) continue;
      seen.add(m.permalink);
      rows.push({
        project_id: projectId,
        platform: "other",
        url: m.permalink,
        keyword: q.term,
        mention_type: q.type,
        competitor: q.competitor ?? null,
      });
    }
  }

  let imported = 0;
  if (rows.length) {
    // Avoid duplicating mentions already stored for this project.
    const { data: existing } = await supabase
      .from("community_mentions")
      .select("url")
      .eq("project_id", projectId);
    const existingUrls = new Set((existing || []).map((r) => r.url));
    const fresh = rows.filter((r) => !existingUrls.has(r.url));

    if (fresh.length) {
      const { error } = await supabase.from("community_mentions").insert(fresh);
      if (!error) imported = fresh.length;
    }
  }

  return NextResponse.json({ found: rows.length, imported, source: "hacker_news", window_days: window });
}
