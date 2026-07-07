import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiNotFound, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { PanelPatchSchema } from "@/lib/validation/schemas";
import { clampRuns, sanitizeEngines } from "@/lib/engines/prompt-panels";

async function loadPanel(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await supabase
    .from("ai_prompt_panels")
    .select("id, project_id, name, description, geos, personas, engines, runs_per_prompt, is_active, last_run_at, created_at, updated_at")
    .eq("id", id)
    .single();
  return data;
}

/** GET /api/panels/[id] — panel detail + members. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const panel = await loadPanel(supabase, id);
  if (!panel) return apiNotFound();
  const access = await verifyProjectAccess(supabase, panel.project_id, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data: members } = await supabase
    .from("ai_prompt_panel_members")
    .select("id, panel_id, project_id, prompt_id, prompt_text, weight")
    .eq("panel_id", id);

  return NextResponse.json({ panel, members: members || [] });
}

interface UpdatePanelBody {
  name?: string;
  description?: string;
  geos?: string[];
  personas?: string[];
  engines?: string[];
  runsPerPrompt?: number;
  isActive?: boolean;
  prompts?: string[];
}

/** PATCH /api/panels/[id] — update panel fields and (optionally) replace members. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const panel = await loadPanel(supabase, id);
  if (!panel) return apiNotFound();
  const access = await verifyProjectAccess(supabase, panel.project_id, user.id, "member");
  if (!access) return apiForbidden();

  const v = await validateBody(request, PanelPatchSchema);
  if (v.response) return v.response;
  const body = v.data;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 200);
  if (typeof body.description === "string") patch.description = body.description.slice(0, 1000);
  if (Array.isArray(body.geos)) patch.geos = body.geos.map((g) => g.trim()).filter(Boolean).slice(0, 20);
  if (Array.isArray(body.personas)) patch.personas = body.personas.map((p) => p.trim()).filter(Boolean).slice(0, 20);
  if (Array.isArray(body.engines)) patch.engines = sanitizeEngines(body.engines);
  if (body.runsPerPrompt !== undefined) patch.runs_per_prompt = clampRuns(body.runsPerPrompt);
  if (typeof body.isActive === "boolean") patch.is_active = body.isActive;

  const { error } = await supabase.from("ai_prompt_panels").update(patch).eq("id", id);
  if (error) return apiError("Failed to update panel", 500);

  // Optional full member replacement.
  if (Array.isArray(body.prompts)) {
    await supabase.from("ai_prompt_panel_members").delete().eq("panel_id", id);
    const prompts = body.prompts.map((p) => p.trim()).filter(Boolean).slice(0, 200);
    if (prompts.length) {
      await supabase.from("ai_prompt_panel_members").insert(
        prompts.map((text) => ({ panel_id: id, project_id: panel.project_id, prompt_text: text.slice(0, 500) }))
      );
    }
  }

  return NextResponse.json({ ok: true });
}

/** DELETE /api/panels/[id]. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const panel = await loadPanel(supabase, id);
  if (!panel) return apiNotFound();
  const access = await verifyProjectAccess(supabase, panel.project_id, user.id, "member");
  if (!access) return apiForbidden();

  const { error } = await supabase.from("ai_prompt_panels").delete().eq("id", id);
  if (error) return apiError("Failed to delete panel", 500);
  return NextResponse.json({ ok: true });
}
