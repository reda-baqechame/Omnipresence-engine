import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiUnauthorized, apiServerError, validateBody } from "@/lib/security/api-response";
import { SprintPatchSchema } from "@/lib/validation/schemas";
import {
  captureSprintSnapshot,
  type SprintItem,
} from "@/lib/engines/action-sprint";
import { triggerProjectScan } from "@/lib/engines/trigger-scan";

/**
 * PATCH /api/sprints/[id]
 * - action "start": capture the visibility baseline and activate the sprint.
 * - action "complete": move to "measuring" and trigger a panel rerun; the
 *   verdict is classified only after the rerun writes fresh measured data
 *   (finalizeMeasuringSprints in the scan runner). Snapshotting immediately
 *   would compare the baseline against itself and always report "unchanged".
 * - action "skip": mark the week skipped.
 * - toggleItemIndex: flip one item's done flag.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(req, SprintPatchSchema);
  if (parsed.response) return parsed.response;

  const { data: sprint } = await supabase.from("action_sprints").select("*").eq("id", id).single();
  if (!sprint) return apiError("Sprint not found", 404);

  const access = await verifyProjectAccess(supabase, sprint.project_id, user.id, "member");
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const update: Record<string, unknown> = {};

  if (typeof parsed.data.toggleItemIndex === "number") {
    const items = (sprint.items || []) as SprintItem[];
    const idx = parsed.data.toggleItemIndex;
    if (idx >= items.length) return apiError("Item index out of range");
    items[idx] = { ...items[idx], done: !items[idx].done };
    update.items = items;
  }

  if (parsed.data.action === "start") {
    if (sprint.status !== "proposed") return apiError("Only a proposed sprint can start", 409);
    update.status = "active";
    update.started_at = new Date().toISOString();
    update.baseline = await captureSprintSnapshot(supabase, sprint.project_id);
  } else if (parsed.data.action === "complete") {
    if (sprint.status !== "active") {
      return apiError("Only an active sprint can complete", 409);
    }
    update.status = "measuring";
    // Remeasure: rerun the panel so the before/after verdict is computed on
    // fresh post-fix data. The scan runner finalizes the sprint when done.
    // Atomic claim mirrors the rescan route; if a scan is already in flight,
    // its completion will finalize this sprint — no second trigger needed.
    const { data: claimed } = await supabase
      .from("projects")
      .update({ status: "scanning" })
      .eq("id", sprint.project_id)
      .neq("status", "scanning")
      .select("id")
      .maybeSingle();
    if (claimed) {
      await triggerProjectScan(sprint.project_id, sprint.organization_id, {
        idempotencyKey: `sprint-remeasure-${sprint.id}`,
      });
    }
  } else if (parsed.data.action === "skip") {
    if (sprint.status === "completed") return apiError("Sprint already completed", 409);
    update.status = "skipped";
  }

  const { data: updated, error } = await supabase
    .from("action_sprints")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) return apiServerError("sprint update failed", error);
  return NextResponse.json({ sprint: updated });
}
