import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiForbidden, apiNotFound, apiUnauthorized } from "@/lib/security/api-response";
import { assertPublicDomain } from "@/lib/security/domain";
import { generatePassageRewrites } from "@/lib/engines/passage-rewriter";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId, url } = await request.json();
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("name, domain")
    .eq("id", projectId)
    .single();
  if (!project?.domain) return apiNotFound();

  // Only rewrite pages on the project's own domain.
  const projectHost = project.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  let targetUrl: string | undefined;
  if (url) {
    try {
      const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
      assertPublicDomain(parsed.hostname);
      const host = parsed.hostname.replace(/^www\./, "");
      if (host !== projectHost && !host.endsWith(`.${projectHost}`)) {
        return NextResponse.json({ error: "URL must be on the project domain" }, { status: 400 });
      }
      targetUrl = parsed.toString();
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
  }

  const result = await generatePassageRewrites(project.domain, project.name, targetUrl);
  return NextResponse.json(result);
}
