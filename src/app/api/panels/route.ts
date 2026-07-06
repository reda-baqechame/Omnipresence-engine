import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { PanelCreateSchema } from "@/lib/validation/schemas";
import { clampRuns, sanitizeEngines } from "@/lib/engines/prompt-panels";

/** GET /api/panels?projectId=... — list panels (with member counts). */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");
  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data: panels, error } = await supabase
    .from("ai_prompt_panels")
    .select("id, project_id, name, description, geos, personas, engines, runs_per_prompt, is_active, last_run_at, created_at, updated_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) return apiError("Failed to load panels", 500);

  const ids = (panels || []).map((p) => p.id);
  const counts: Record<string, number> = {};
  if (ids.length) {
    const { data: members } = await supabase
      .from("ai_prompt_panel_members")
      .select("panel_id")
      .in("panel_id", ids);
    for (const m of members || []) counts[m.panel_id] = (counts[m.panel_id] || 0) + 1;
  }

  return NextResponse.json({
    panels: (panels || []).map((p) => ({ ...p, member_count: counts[p.id] || 0 })),
  });
}

interface CreatePanelBody {
  description?: string;
  geos?: string[];
  personas?: string[];
  engines?: string[];
  runsPerPrompt?: number;
}

/** POST /api/panels — create a panel + its prompt members. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(request, PanelCreateSchema);
  if (parsed.response) return parsed.response;
  const validated = parsed.data;
  const { projectId, name, prompts } = validated;
  const body = validated as typeof validated & CreatePanelBody;
  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const promptList = prompts.map((p) => p.trim()).filter(Boolean).slice(0, 200);

  const { data: panel, error } = await supabase
    .from("ai_prompt_panels")
    .insert({
      project_id: projectId,
      name: name.slice(0, 200),
      description: body.description?.slice(0, 1000) || null,
      geos: (body.geos || []).map((g) => g.trim()).filter(Boolean).slice(0, 20),
      personas: (body.personas || []).map((p) => p.trim()).filter(Boolean).slice(0, 20),
      engines: sanitizeEngines(body.engines),
      runs_per_prompt: clampRuns(body.runsPerPrompt),
    })
    .select("id")
    .single();
  if (error || !panel) return apiError("Failed to create panel", 500);

  if (promptList.length) {
    await supabase.from("ai_prompt_panel_members").insert(
      promptList.map((text) => ({
        panel_id: panel.id,
        project_id: projectId,
        prompt_text: text.slice(0, 500),
      }))
    );
  }

  return NextResponse.json({ id: panel.id, member_count: promptList.length }, { status: 201 });
}
