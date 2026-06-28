import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  encryptCredentials,
  maskCredentials,
} from "@/lib/security/credential-vault";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";

const VALID_PROVIDERS = new Set(["wordpress", "webflow", "shopify", "buffer", "ayrshare", "gbp", "clarity"]);

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data } = await supabase
    .from("project_integrations")
    .select("id, provider, metadata, is_active, updated_at")
    .eq("project_id", projectId);

  return NextResponse.json({ integrations: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId, provider, credentials, metadata } = await readJsonBody(request) as {
    projectId: string;
    provider: string;
    credentials: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };

  if (!projectId || !provider || !credentials) {
    return apiError("projectId, provider, credentials required");
  }
  if (!VALID_PROVIDERS.has(provider)) return apiError("Invalid provider");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "admin");
  if (!access) return apiForbidden();

  const encrypted = encryptCredentials(credentials);

  const { data, error } = await supabase
    .from("project_integrations")
    .upsert(
      {
        project_id: projectId,
        provider,
        credentials_encrypted: encrypted,
        metadata: metadata || {},
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,provider" }
    )
    .select("id, provider, metadata, is_active, updated_at")
    .single();

  if (error) return apiError(error.message);

  return NextResponse.json({
    integration: data,
    credentialsPreview: maskCredentials(credentials),
  });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  const provider = request.nextUrl.searchParams.get("provider");
  if (!projectId || !provider) return apiError("projectId and provider required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "admin");
  if (!access) return apiForbidden();

  await supabase
    .from("project_integrations")
    .delete()
    .eq("project_id", projectId)
    .eq("provider", provider);

  return NextResponse.json({ ok: true });
}
