import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data } = await supabase
    .from("annotations")
    .select("*")
    .eq("project_id", projectId)
    .order("date", { ascending: false })
    .limit(200);

  return NextResponse.json({ annotations: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await request.json();
  const { projectId, label, date, annotationType } = body as {
    projectId: string;
    label: string;
    date?: string;
    annotationType?: string;
  };
  if (!projectId || !label) return apiError("projectId and label required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const validTypes = ["note", "publish", "fix", "campaign", "algo_update"];
  const type = validTypes.includes(annotationType || "") ? annotationType : "note";

  const { data, error } = await supabase
    .from("annotations")
    .insert({
      project_id: projectId,
      label,
      date: date || new Date().toISOString().slice(0, 10),
      annotation_type: type,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) return apiError("Failed to create annotation", 500);
  return NextResponse.json({ annotation: data });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const id = request.nextUrl.searchParams.get("id");
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!id || !projectId) return apiError("id and projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  await supabase.from("annotations").delete().eq("id", id).eq("project_id", projectId);
  return NextResponse.json({ ok: true });
}
