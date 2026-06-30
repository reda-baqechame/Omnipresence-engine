import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiNotFound, apiUnauthorized } from "@/lib/security/api-response";
import { inngest } from "@/lib/inngest/client";
import { estimatePanelCalls } from "@/lib/engines/prompt-panels";

/** POST /api/panels/[id]/run — queue a panel run (executed off-request by Inngest). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { data: panel } = await supabase
    .from("ai_prompt_panels")
    .select("id, project_id, geos, personas, engines, runs_per_prompt")
    .eq("id", id)
    .single();
  if (!panel) return apiNotFound();

  const access = await verifyProjectAccess(supabase, panel.project_id, user.id, "member");
  if (!access) return apiForbidden();

  const { count } = await supabase
    .from("ai_prompt_panel_members")
    .select("id", { count: "exact", head: true })
    .eq("panel_id", id);
  if (!count) return apiError("Panel has no prompts to run", 400);

  const cells = estimatePanelCalls(panel, count);

  try {
    await inngest.send({
      name: "panel/run.requested",
      data: { panelId: id, projectId: panel.project_id },
    });
  } catch {
    return apiError("Failed to queue panel run", 502);
  }

  return NextResponse.json({ queued: true, cells, prompts: count });
}
