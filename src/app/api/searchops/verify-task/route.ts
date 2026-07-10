import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import {
  markTaskReadyForVerification,
  verifySearchOpsTask,
} from "@/lib/engines/searchops-task-loop";
import type { ExecutionTask } from "@/types/database";

export const runtime = "nodejs";

const BodySchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid(),
  action: z.enum(["ready_for_verification", "verify"]),
  afterMetric: z.record(z.string(), z.unknown()).nullable().optional(),
  unavailableReason: z.string().trim().max(2000).nullable().optional(),
});

/**
 * SearchOps verification loop on existing execution_tasks + results_ledger.
 * - ready_for_verification → status done (awaiting measured after)
 * - verify → verified only with measured before/after; else verification_unavailable
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(request, BodySchema);
  if (parsed.response) return parsed.response;
  const { projectId, taskId, action, afterMetric, unavailableReason } = parsed.data;

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: task } = await supabase
    .from("execution_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("project_id", projectId)
    .single();

  if (!task) return apiError("Task not found", 404);

  if (action === "ready_for_verification") {
    const result = await markTaskReadyForVerification(supabase, taskId);
    if ("error" in result) return apiError(result.error, 500);
    return NextResponse.json({
      ok: true,
      status: "ready_for_verification",
      task: result.task,
    });
  }

  const et = task as ExecutionTask;
  if (et.source_module !== "searchops_opportunity" && !et.evidence?.searchops_opportunity_id) {
    return apiError("Task is not linked to a SearchOps opportunity", 400);
  }

  const outcome = await verifySearchOpsTask(supabase, {
    task: et,
    afterMetric: afterMetric ?? null,
    unavailableReason: unavailableReason ?? null,
  });

  if (!outcome.ok) return apiError(outcome.error, 500);

  return NextResponse.json({
    ok: true,
    status: outcome.status,
    task: outcome.task,
    ledgerId: outcome.status === "verified" ? outcome.ledgerId : null,
    reason: outcome.status === "verification_unavailable" ? outcome.reason : null,
  });
}
