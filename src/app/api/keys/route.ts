import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { generateApiKey } from "@/lib/security/api-keys";

async function getOrgId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(1)
    .single();
  return data?.organization_id || null;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const orgId = await getOrgId(supabase, user.id);
  if (!orgId) return apiError("No organization");

  const { data } = await supabase
    .from("api_keys")
    .select("id, name, prefix, last_used_at, revoked, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  return NextResponse.json({ keys: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const orgId = await getOrgId(supabase, user.id);
  if (!orgId) return apiError("No organization");

  const body = await readJsonBody(request).catch(() => ({}));
  const name = (body.name as string) || "API key";

  const { key, prefix, hash } = generateApiKey();
  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      organization_id: orgId,
      name,
      prefix,
      key_hash: hash,
      created_by: user.id,
    })
    .select("id, name, prefix, created_at")
    .single();

  if (error) return apiError("Failed to create API key", 500);

  // The full key is returned exactly once.
  return NextResponse.json({ ...data, key });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const orgId = await getOrgId(supabase, user.id);
  if (!orgId) return apiError("No organization");

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return apiError("id required");

  await supabase
    .from("api_keys")
    .update({ revoked: true })
    .eq("id", id)
    .eq("organization_id", orgId);

  return NextResponse.json({ ok: true });
}
