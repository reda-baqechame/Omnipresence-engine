import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { measurePromptDemandBatch } from "@/lib/engines/prompt-demand";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await readJsonBody(request);
  const { projectId } = body as { projectId?: string };
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data: prompts } = await supabase
    .from("prompts")
    .select("text, is_tracked")
    .eq("project_id", projectId)
    .eq("is_tracked", true)
    .order("priority", { ascending: false })
    .limit(30);

  const texts = (prompts || []).map((p) => p.text).filter(Boolean);
  if (!texts.length) {
    return NextResponse.json({ signals: [], message: "No tracked prompts" });
  }

  const signals = await measurePromptDemandBatch(texts, { max: 30 });
  return NextResponse.json({ signals, count: signals.length });
}
