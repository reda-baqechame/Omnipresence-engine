import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import {
  findCompetitorBacklinkGap,
  generateDigitalPrAssets,
  findUnlinkedMentions,
  generateExpertQuotes,
} from "@/lib/engines/link-intelligence";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await readJsonBody(request);
  const { projectId, action } = body as {
    projectId: string;
    action: "competitor_gap" | "pr_assets" | "unlinked_mentions" | "expert_quotes";
  };
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("name, domain, industry")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  if (action === "competitor_gap") {
    return NextResponse.json(await findCompetitorBacklinkGap(supabase, projectId, project.domain));
  }
  if (action === "pr_assets") {
    return NextResponse.json(
      await generateDigitalPrAssets({ brand: project.name || project.domain, industry: project.industry || undefined })
    );
  }
  if (action === "unlinked_mentions") {
    return NextResponse.json(await findUnlinkedMentions(project.name || project.domain, project.domain));
  }
  if (action === "expert_quotes") {
    return NextResponse.json(
      await generateExpertQuotes({ brand: project.name || project.domain, industry: project.industry || undefined })
    );
  }

  return apiError("Unknown action");
}
