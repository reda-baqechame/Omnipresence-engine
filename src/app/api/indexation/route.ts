import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { getValidOAuthToken } from "@/lib/oauth/tokens";
import { fetchGscPagePerformance, type GscPageRow } from "@/lib/engines/gsc-queries";
import {
  classifyIndexCoverageBatch,
  analyzeCrawlerLogs,
  type IndexCoverageInput,
} from "@/lib/engines/indexation-intelligence";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const [coverage, crawlerReport] = await Promise.all([
    supabase
      .from("index_coverage_items")
      .select("url, action, reason, confidence, resolved")
      .eq("project_id", projectId)
      .order("confidence", { ascending: false })
      .limit(500),
    supabase
      .from("crawler_log_reports")
      .select("total_lines, parsed_hits, ai_bots_seen, search_bots_seen, report, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    coverage: coverage.data || [],
    crawlerReport: crawlerReport.data || null,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await readJsonBody(request);
  const { projectId, action, logText } = body as {
    projectId: string;
    action: "coverage" | "crawler_logs";
    logText?: string;
  };
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("domain")
    .eq("id", projectId)
    .single();
  if (!project?.domain) return apiError("Project not found", 404);

  if (action === "coverage") {
    const token = await getValidOAuthToken(supabase, projectId, "google_search_console");
    if (!token) {
      return NextResponse.json({
        available: false,
        reason: "Connect Google Search Console to classify index coverage from real page performance.",
      });
    }

    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const pages: GscPageRow[] = await fetchGscPagePerformance(token, project.domain, start, end, 1000);

    if (!pages.length) {
      return NextResponse.json({ available: false, reason: "No Search Console page data in the last 90 days." });
    }

    // Crawl for HTTP status (best-effort; status 200 assumed when crawl skipped).
    let statusByUrl = new Map<string, number>();
    try {
      const { runSiteCrawl } = await import("@/lib/engines/site-crawler");
      const crawl = await runSiteCrawl(project.domain, 100);
      statusByUrl = new Map(crawl.pages.map((p) => [p.url, p.status]));
    } catch {
      // proceed without crawl status
    }

    const inputs: IndexCoverageInput[] = pages.map((p) => ({
      url: p.url,
      clicks: p.clicks,
      impressions: p.impressions,
      position: p.position,
      status: statusByUrl.get(p.url) ?? 200,
    }));

    const { items, summary } = classifyIndexCoverageBatch(inputs);

    const rows = items.map((i) => ({
      project_id: projectId,
      url: i.url,
      action: i.action,
      reason: i.reason,
      confidence: i.confidence,
      resolved: false,
    }));
    if (rows.length) {
      await supabase.from("index_coverage_items").upsert(rows, { onConflict: "project_id,url" });
    }

    return NextResponse.json({ available: true, summary, items: items.slice(0, 200) });
  }

  if (action === "crawler_logs") {
    if (!logText || logText.length < 10) return apiError("logText required");
    const report = analyzeCrawlerLogs(logText);
    await supabase.from("crawler_log_reports").insert({
      project_id: projectId,
      total_lines: report.totalLines,
      parsed_hits: report.parsedHits,
      ai_bots_seen: report.aiBotsSeen,
      search_bots_seen: report.searchBotsSeen,
      report,
    });
    return NextResponse.json({ available: true, report });
  }

  return apiError("Unknown action");
}
