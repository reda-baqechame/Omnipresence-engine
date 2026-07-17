import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { AskQuestionSchema } from "@/lib/validation/schemas";
import { askProjectAgent } from "@/lib/engines/ask-agent";
import { guardOrgEndpoint } from "@/lib/security/api-v1-guard";

// Quality-mode generation over the sovereign-first router can take ~20s+.
export const maxDuration = 60;

/** POST /api/projects/[id]/ask — grounded Q&A over the project's own data. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const access = await verifyProjectAccess(supabase, id, user.id);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = await validateBody(req, AskQuestionSchema);
  if (parsed.response) return parsed.response;

  // LLM-metered — bound per-org throughput.
  const limited = await guardOrgEndpoint(access.organizationId, "ask-agent", 30, 60 * 60 * 1000);
  if (limited) return limited;

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, domain")
    .eq("id", id)
    .single();
  if (!project) return apiError("Project not found", 404);

  const result = await askProjectAgent(
    supabase,
    { id: project.id, brand_name: project.name, domain: project.domain },
    parsed.data.question
  );
  if ("error" in result) return apiError(result.error, 503);

  return NextResponse.json(result);
}
