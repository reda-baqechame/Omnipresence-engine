import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";

interface ProbeTrace {
  id: string;
  engine: string;
  prompt: string;
  response_excerpt: string | null;
  brand_mentioned: boolean;
  brand_cited: boolean;
  cited_sources: string[];
  competitors_mentioned: string[];
  model: string | null;
  grounding_mode: string | null;
  confidence: number | null;
  data_source: string | null;
  checked_at: string;
}

function toCsv(rows: ProbeTrace[]): string {
  const headers = [
    "checked_at", "engine", "prompt", "brand_mentioned", "brand_cited",
    "competitors_mentioned", "cited_sources", "model", "grounding_mode",
    "confidence", "data_source", "response_excerpt",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.checked_at, r.engine, r.prompt, r.brand_mentioned, r.brand_cited,
      r.competitors_mentioned, r.cited_sources, r.model, r.grounding_mode,
      r.confidence, r.data_source, r.response_excerpt,
    ].map(esc).join(","));
  }
  return lines.join("\n");
}

/**
 * Per-prompt AEO observability: win/loss history, competitor citation timeline,
 * and "prompts where competitors win". Supports `format=csv` / `format=json`
 * export and optional `engine` / `prompt` filters.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const params = request.nextUrl.searchParams;
  const projectId = params.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const engine = params.get("engine");
  const promptFilter = params.get("prompt");
  const format = params.get("format");
  const limit = Math.min(Number(params.get("limit") || 1000), 5000);

  let query = supabase
    .from("ai_probe_traces")
    .select(
      "id, engine, prompt, response_excerpt, brand_mentioned, brand_cited, cited_sources, competitors_mentioned, model, grounding_mode, confidence, data_source, checked_at"
    )
    .eq("project_id", projectId)
    .order("checked_at", { ascending: false })
    .limit(limit);

  if (engine) query = query.eq("engine", engine);
  if (promptFilter) query = query.eq("prompt", promptFilter);

  const { data, error } = await query;
  if (error) return apiError("Failed to load traces", 500);
  const traces = (data || []) as ProbeTrace[];

  if (format === "csv") {
    return new NextResponse(toCsv(traces), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ai-probe-traces-${projectId}.csv"`,
      },
    });
  }

  // Aggregate: prompts where competitors win (brand absent, a competitor present).
  const byPrompt = new Map<
    string,
    { prompt: string; probes: number; brandWins: number; competitorWins: number; lastCheckedAt: string }
  >();
  for (const t of traces) {
    const agg = byPrompt.get(t.prompt) || {
      prompt: t.prompt,
      probes: 0,
      brandWins: 0,
      competitorWins: 0,
      lastCheckedAt: t.checked_at,
    };
    agg.probes += 1;
    if (t.brand_mentioned) agg.brandWins += 1;
    if (!t.brand_mentioned && t.competitors_mentioned.length > 0) agg.competitorWins += 1;
    if (t.checked_at > agg.lastCheckedAt) agg.lastCheckedAt = t.checked_at;
    byPrompt.set(t.prompt, agg);
  }
  const competitorWinPrompts = [...byPrompt.values()]
    .filter((p) => p.competitorWins > 0 && p.brandWins === 0)
    .sort((a, b) => b.competitorWins - a.competitorWins)
    .slice(0, 50);

  const total = traces.length;
  const mentioned = traces.filter((t) => t.brand_mentioned).length;
  const cited = traces.filter((t) => t.brand_cited).length;

  return NextResponse.json({
    traces,
    summary: {
      total,
      mentionRate: total ? mentioned / total : 0,
      citationRate: total ? cited / total : 0,
      competitorWinPrompts,
    },
  });
}
