import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { SchemaDeploySchema } from "@/lib/validation/schemas";
import { deploySchemaToWordPress, deploySchemaToWebflow } from "@/lib/engines/schema-engine";
import { loadProjectIntegration, type CmsCredentials } from "@/lib/integrations/store";
import { recordLedgerAction } from "@/lib/engines/results-ledger";

/**
 * Deploy a JSON-LD snippet to the user's live site via their connected CMS.
 * Uses stored, encrypted CMS credentials — never accepts secrets over the wire.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const v = await validateBody(request, SchemaDeploySchema);
  if (v.response) return v.response;
  const { projectId, platform, htmlSnippet, postId, itemId } = v.data as {
    projectId: string;
    platform: "wordpress" | "webflow";
    htmlSnippet: string;
    postId?: number;
    itemId?: string;
  };

  if (platform !== "wordpress" && platform !== "webflow") return apiError("Unsupported platform");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const creds = await loadProjectIntegration<CmsCredentials>(supabase, projectId, platform);
  if (!creds?.apiKey) {
    return apiError(`No active ${platform} integration. Connect it in project settings first.`, 400);
  }

  let result: { success: boolean; error?: string };
  if (platform === "wordpress") {
    if (!creds.url) return apiError("WordPress URL missing from integration");
    if (!postId) return apiError("postId required for WordPress deploy");
    result = await deploySchemaToWordPress(creds.url, creds.apiKey, postId, htmlSnippet);
  } else {
    if (!creds.siteId || !creds.collectionId || !itemId) {
      return apiError("siteId, collectionId, and itemId required for Webflow deploy");
    }
    result = await deploySchemaToWebflow(creds.siteId, creds.apiKey, creds.collectionId, itemId, htmlSnippet);
  }

  await recordLedgerAction(supabase, {
    project_id: projectId,
    action_type: "schema_deployed",
    action_surface: "website",
    description: `Deployed JSON-LD schema to ${platform}`,
    status: result.success ? "completed" : "failed",
    outcome_snapshot: { platform, success: result.success, error: result.error },
  });

  if (!result.success) return apiError(result.error || "Deploy failed", 502);
  return NextResponse.json({ ok: true });
}
