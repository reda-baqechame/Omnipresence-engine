import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { discoverRisingTopics, clusterKeywordsByIntent } from "@/lib/engines/demand-discovery";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await readJsonBody(request);
  const { projectId, action, seed, geo, queueContent } = body as {
    projectId: string;
    action: "rising" | "cluster";
    seed?: string;
    geo?: string;
    queueContent?: boolean;
  };
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("name, industry")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  if (action === "rising") {
    const seedTopic = seed || project.industry || project.name;
    if (!seedTopic) return apiError("seed or project industry required");

    const result = await discoverRisingTopics({ seed: seedTopic, geo });

    let queued = 0;
    if (queueContent) {
      for (const topic of result.rising.filter((t) => t.createNow).slice(0, 3)) {
        await supabase.from("content_assets").insert({
          project_id: projectId,
          type: "blog_brief",
          title: topic.topic,
          content: `Rising demand signal (${topic.source}). Momentum ${topic.momentum}, community hits ${topic.communityHits}. Intent: ${topic.intent}.`,
          status: "drafted",
          metadata: { source: "demand_discovery", rising_source: topic.source, intent: topic.intent },
        });
        queued++;
      }
    }

    return NextResponse.json({ ...result, queued });
  }

  if (action === "cluster") {
    const { data: kws } = await supabase
      .from("keyword_opportunities")
      .select("keyword")
      .eq("project_id", projectId)
      .limit(500);
    const keywords = (kws || []).map((k) => k.keyword as string).filter(Boolean);
    const clusters = clusterKeywordsByIntent(keywords);
    return NextResponse.json({ clusters, total: keywords.length });
  }

  return apiError("Unknown action");
}
