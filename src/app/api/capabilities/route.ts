import { NextResponse } from "next/server";
import { getCapabilitiesSummary } from "@/lib/config/capabilities";
import { getProductionReadiness } from "@/lib/config/production";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  // The capabilities/production matrix reveals which providers/keys are
  // configured and any deployment blockers — auth-gate it so it isn't a public
  // reconnaissance surface.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ...getCapabilitiesSummary(),
    production: getProductionReadiness(),
  });
}
