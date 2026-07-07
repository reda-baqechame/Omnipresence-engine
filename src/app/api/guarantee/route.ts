import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiForbidden, apiNotFound, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { GuaranteePostSchema } from "@/lib/validation/schemas";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import {
  lockGuaranteeBaseline,
  submitGuaranteeClaim,
  verifyGuaranteeContract,
} from "@/lib/engines/guarantee";
import { getLedgerForProject } from "@/lib/engines/results-ledger";

export async function GET(request: NextRequest) {
  const blocked = await guardPublicEndpoint(request, "guarantee", 60, 60_000);
  if (blocked) return blocked;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const [{ data: contract }, { data: claims }, ledger] = await Promise.all([
    supabase.from("guarantee_contracts").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("guarantee_claims").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
    getLedgerForProject(supabase, projectId, 20),
  ]);

  return NextResponse.json({ contract, claims: claims || [], ledger });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const v = await validateBody(request, GuaranteePostSchema);
  if (v.response) return v.response;
  const body = v.data;

  const access = await verifyProjectAccess(supabase, body.projectId, user.id, "member");
  if (!access) return apiForbidden();

  if (body.action === "lock_baseline" && body.snapshot) {
    const contract = await lockGuaranteeBaseline(supabase, body.projectId, body.snapshot);
    return NextResponse.json({ contract });
  }

  if (body.action === "verify" && body.currentMetrics) {
    const result = await verifyGuaranteeContract(supabase, body.projectId, body.currentMetrics);
    if (!result) return apiNotFound();
    return NextResponse.json(result);
  }

  if (body.action === "claim") {
    const claim = await submitGuaranteeClaim(supabase, body.projectId, body.evidence || []);
    if (!claim) return NextResponse.json({ error: "No failed contract to claim" }, { status: 400 });
    return NextResponse.json({ claim });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
