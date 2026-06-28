import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PromptCategory } from "@/types/database";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { fetchGscTopQueries } from "@/lib/engines/gsc-queries";
import { getValidOAuthToken } from "@/lib/oauth/tokens";

const VALID_CATEGORIES = new Set<PromptCategory>([
  "best_of",
  "comparison",
  "local",
  "problem_aware",
  "solution_aware",
  "pricing",
  "trust",
  "alternatives",
  "reviews",
  "transactional",
]);

function parsePromptCsv(csv: string): Array<{
  text: string;
  category: PromptCategory;
  priority: number;
}> {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const header = lines[0].toLowerCase();
  const hasHeader = header.includes("text") || header.includes("prompt");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line) => {
      const parts = line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
      const text = parts[0];
      if (!text) return null;
      const rawCategory = (parts[1] || "solution_aware").toLowerCase().replace(/\s+/g, "_");
      const category = VALID_CATEGORIES.has(rawCategory as PromptCategory)
        ? (rawCategory as PromptCategory)
        : "solution_aware";
      const priority = Math.min(100, Math.max(1, parseInt(parts[2] || "50", 10) || 50));
      return { text, category, priority };
    })
    .filter((row): row is { text: string; category: PromptCategory; priority: number } => !!row);
}

function inferCategoryFromQuery(query: string): PromptCategory {
  const q = query.toLowerCase();
  if (/\b(near me|in [a-z]+)\b/.test(q) || q.includes("local")) return "local";
  if (/\b(vs|versus|compared|compare)\b/.test(q)) return "comparison";
  if (/\b(best|top \d+|top rated)\b/.test(q)) return "best_of";
  if (/\b(price|cost|how much|pricing)\b/.test(q)) return "pricing";
  if (/\b(review|rating|testimonial)\b/.test(q)) return "reviews";
  if (/\b(alternative|instead of|replace)\b/.test(q)) return "alternatives";
  if (/\b(trust|reliable|legit)\b/.test(q)) return "trust";
  if (/\b(buy|hire|book|quote)\b/.test(q)) return "transactional";
  if (/\b(how to|fix|problem|why)\b/.test(q)) return "problem_aware";
  return "solution_aware";
}

async function batchInsertPrompts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  rows: Array<{ text: string; category: PromptCategory; priority: number }>
): Promise<number> {
  const CHUNK = 100;
  let imported = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("prompts")
      .insert(
        chunk.map((row) => ({
          project_id: projectId,
          text: row.text,
          category: row.category,
          priority: row.priority,
          is_tracked: true,
        }))
      )
      .select("id");
    if (error) throw new Error(error.message);
    imported += data?.length ?? 0;
  }
  return imported;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data } = await supabase
    .from("prompts")
    .select("id, text, category, priority, is_tracked, created_at")
    .eq("project_id", projectId)
    .order("priority", { ascending: false });

  return NextResponse.json({ prompts: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await readJsonBody(request);
  const { projectId, csv, prompts: inlinePrompts, action } = body as {
    projectId: string;
    csv?: string;
    prompts?: Array<{ text: string; category?: PromptCategory; priority?: number }>;
    action?: "import_gsc";
  };

  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  if (action === "import_gsc") {
    const token = await getValidOAuthToken(supabase, projectId, "google_search_console");
    if (!token) return apiError("Connect Google Search Console first", 400);

    const { data: project } = await supabase.from("projects").select("domain").eq("id", projectId).single();
    if (!project?.domain) return apiError("Project domain required");

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 28);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const queries = await fetchGscTopQueries(token, project.domain, fmt(start), fmt(end), 500);
    if (!queries.length) return apiError("No GSC queries returned for this property");

    const rows = queries.map((q) => ({
      text: q.query,
      category: inferCategoryFromQuery(q.query),
      priority: Math.min(100, Math.max(10, Math.round(q.impressions / 10))),
    }));

    try {
      const imported = await batchInsertPrompts(supabase, projectId, rows);
      return NextResponse.json({ imported, source: "gsc" });
    } catch (e) {
      return apiError(e instanceof Error ? e.message : "GSC import failed");
    }
  }

  const rows = csv
    ? parsePromptCsv(csv)
    : (inlinePrompts || [])
        .filter((p) => p.text?.trim())
        .map((p) => ({
          text: p.text.trim(),
          category: p.category && VALID_CATEGORIES.has(p.category) ? p.category : ("solution_aware" as PromptCategory),
          priority: p.priority ?? 50,
        }));

  if (!rows.length) return apiError("No valid prompts in import");

  try {
    const imported = await batchInsertPrompts(supabase, projectId, rows);
    return NextResponse.json({ imported });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Import failed");
  }
}
