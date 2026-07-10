import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import type { SearchOpsOpportunity } from "@/lib/engines/searchops-opportunity-engine";
import { createTaskFromOpportunity } from "@/lib/engines/searchops-task-loop";

export const runtime = "nodejs";

const OpportunitySchema = z.object({
  id: z.string().min(1).max(500),
  projectId: z.string().uuid(),
  category: z.string().min(1).max(64),
  title: z.string().min(1).max(500),
  diagnosis: z.string().min(1).max(5000),
  evidence: z
    .array(
      z.object({
        label: z.string(),
        source: z.string(),
        status: z.enum(["measured", "estimated", "unavailable", "model_knowledge", "simulated"]),
        confidence: z.number().nullable(),
        value: z.unknown().optional(),
        evidenceId: z.string().nullable().optional(),
      })
    )
    .min(1)
    .max(20),
  priority: z.enum(["critical", "high", "medium", "low"]),
  impactType: z.enum(["measured", "estimated", "unavailable", "model_knowledge", "simulated"]),
  effort: z.enum(["low", "medium", "high"]),
  recommendedAction: z.string().min(1).max(5000),
  verificationPlan: z.string().min(1).max(5000),
  limitations: z.array(z.string().max(1000)).max(20),
});

const BodySchema = z.object({
  projectId: z.string().uuid(),
  opportunity: OpportunitySchema,
});

/**
 * Explicit create-task-from-opportunity — authenticated, member+.
 * Preserves evidence snapshot in execution_tasks.evidence / before_metric.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(request, BodySchema);
  if (parsed.response) return parsed.response;
  const { projectId, opportunity } = parsed.data;

  if (opportunity.projectId !== projectId) {
    return apiError("opportunity.projectId must match projectId");
  }

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const result = await createTaskFromOpportunity(supabase, {
    projectId,
    organizationId: access.organizationId,
    opportunity: opportunity as SearchOpsOpportunity,
  });

  if ("error" in result) return apiError(result.error, 500);

  return NextResponse.json({
    task: result.task,
    created: result.created,
    searchops_opportunity_id: opportunity.id,
  });
}
