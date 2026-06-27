import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiNotFound, apiUnauthorized } from "@/lib/security/api-response";
import { assertPublicDomain } from "@/lib/security/domain";
import { generatePassageRewrites } from "@/lib/engines/passage-rewriter";
import { markdownToHtml } from "@/lib/engines/structural-aeo";
import { publishViaCms, loadProjectIntegration, type CmsCredentials, type CmsPlatform } from "@/lib/integrations/store";
import { recordLedgerAction } from "@/lib/engines/results-ledger";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId, url, publish, platform } = (await request.json()) as {
    projectId?: string;
    url?: string;
    publish?: boolean;
    platform?: CmsPlatform;
  };
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

  // Optional publish path: push the assembled structural doc + JSON-LD to the CMS.
  if (publish) {
    if (!platform) return apiError("platform required to publish");
    if (!result.structured) return apiError("Nothing to publish — rewrite produced no structured doc", 400);

    const creds = await loadProjectIntegration<CmsCredentials>(supabase, projectId, platform);
    if (!creds?.apiKey) {
      return apiError(`No active ${platform} integration. Connect it first.`, 400);
    }

    const jsonLdScripts = result.structured.jsonLd
      .map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
      .join("\n");
    const html = `${markdownToHtml(result.structured.markdown)}\n${jsonLdScripts}`;

    const published = await publishViaCms(platform, creds, {
      title: result.structured.markdown.match(/^#\s+(.*)/)?.[1] || project.name,
      content: html,
    });

    await recordLedgerAction(supabase, {
      project_id: projectId,
      action_type: "structural_content_published",
      action_surface: "website",
      description: `Published answer-first structural content to ${platform}`,
      status: published.ok ? "completed" : "failed",
      outcome_snapshot: { platform, publishedUrl: published.publishedUrl, qc: result.structured.qc.score },
    });

    return NextResponse.json({ ...result, published });
  }

  return NextResponse.json(result);
}
