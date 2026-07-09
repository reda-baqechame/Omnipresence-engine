import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isPlatformAdminAuthorized } from "@/lib/security/admin-auth";
import { apiUnauthorized } from "@/lib/security/api-response";
import { loadProviderProofCockpit } from "@/lib/engines/provider-proof";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await isPlatformAdminAuthorized(request, "BENCHMARK_SECRET"))) {
    return apiUnauthorized();
  }

  const lookback = Number(request.nextUrl.searchParams.get("lookbackDays")) || 45;
  const supabase = await createServiceClient();
  try {
    const data = await loadProviderProofCockpit(supabase, lookback);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "provider proof failed" },
      { status: 500 }
    );
  }
}
