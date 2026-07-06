import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchDailyTrends, matchTrendsToIndustry, trendToContentTopic } from "@/lib/engines/trend-discovery";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { guardPublicEndpoint } from "@/lib/security/public-guard";

export async function GET(request: NextRequest) {
  const limited = await guardPublicEndpoint(request, "trends-get", 30, 60 * 60 * 1000);
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const geo = request.nextUrl.searchParams.get("geo") || "US";
  const industry = request.nextUrl.searchParams.get("industry") || "";
  const trends = await fetchDailyTrends(geo);
  const matched = industry ? matchTrendsToIndustry(trends, industry) : trends.slice(0, 15);
  return NextResponse.json({ trends: matched, total: trends.length, geo });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId, geo, queueContent } = await readJsonBody(request) as {
    projectId: string;
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

  const trends = await fetchDailyTrends(geo || "US");
  const matched = matchTrendsToIndustry(trends, project.industry || "business", 8);

  let queued = 0;
  if (queueContent) {
    for (const trend of matched.slice(0, 3)) {
      const topic = trendToContentTopic(trend, project.name, project.industry || "business");
      await supabase.from("content_assets").insert({
        project_id: projectId,
        type: "blog_brief",
        title: topic,
        content: `Trend signal: ${trend.title}\nTraffic: ${trend.traffic || "unknown"}\nViral score: ${trend.viralScore}/100`,
        status: "drafted",
        metadata: { trend_title: trend.title, viral_score: trend.viralScore, source: "google_trends" },
      });
      queued++;
    }
  }

  return NextResponse.json({ trends: matched, queued });
}
