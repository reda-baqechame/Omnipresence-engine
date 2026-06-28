import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  parseMentionsCsv,
  summarizeMentions,
  fetchLiveCommunityMentions,
  fetchFirehoseMentions,
} from "@/lib/engines/community-mentions";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";

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

  const body = (await readJsonBody(request)) as {
    projectId: string;
    csv?: string;
    action?: "fetch_live" | "fetch_firehose";
  };
  const { projectId, csv, action } = body;
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  // Broader firehose: Stack Exchange, Product Hunt, GitHub, Mastodon, Bluesky, Wikipedia.
  if (action === "fetch_firehose") {
    const { data: project } = await supabase
      .from("projects")
      .select("name, competitors")
      .eq("id", projectId)
      .single();
    if (!project?.name) return apiError("Project name required for firehose");

    const { rows: liveRows, byPlatform, available } = await fetchFirehoseMentions(
      project.name,
      (project.competitors || []) as string[]
    );

    const { data: existing } = await supabase
      .from("community_mentions")
      .select("url")
      .eq("project_id", projectId);
    const existingUrls = new Set((existing || []).map((e) => e.url));
    const newRows = liveRows.filter((r) => !existingUrls.has(r.url));

    if (newRows.length) {
      await supabase.from("community_mentions").insert(
        newRows.map((r) => ({
          project_id: projectId,
          platform: r.platform,
          url: r.url,
          keyword: r.keyword,
          mention_type: r.mention_type || "brand",
        }))
      );
    }

    return NextResponse.json({ fetched: liveRows.length, inserted: newRows.length, byPlatform, available });
  }

  // Live fetch: Reddit (official API, or keyless SERP fallback) + Quora (SERP) mentions, deduped against stored rows.
  if (action === "fetch_live") {
    const { data: project } = await supabase
      .from("projects")
      .select("name, competitors")
      .eq("id", projectId)
      .single();
    if (!project?.name) return apiError("Project name required for live fetch");

    const { rows: liveRows, redditAvailable } = await fetchLiveCommunityMentions(
      project.name,
      (project.competitors || []) as string[]
    );

    const { data: existing } = await supabase
      .from("community_mentions")
      .select("url")
      .eq("project_id", projectId);
    const existingUrls = new Set((existing || []).map((e) => e.url));
    const newRows = liveRows.filter((r) => !existingUrls.has(r.url));

    if (newRows.length) {
      await supabase.from("community_mentions").insert(
        newRows.map((r) => ({
          project_id: projectId,
          platform: r.platform,
          url: r.url,
          keyword: r.keyword,
          mention_type: r.mention_type || "brand",
        }))
      );
    }

    return NextResponse.json({
      fetched: liveRows.length,
      inserted: newRows.length,
      redditAvailable,
      note: redditAvailable
        ? undefined
        : "Reddit API not configured — Reddit mentions discovered via keyless SERP. Set REDDIT_CLIENT_ID/SECRET for richer (full-text) coverage.",
    });
  }

  if (!csv) return apiError("csv or action required");

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
