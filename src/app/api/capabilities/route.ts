import { NextResponse } from "next/server";
import { getCapabilitiesSummary } from "@/lib/config/capabilities";
import { getClaimsCoverage } from "@/lib/config/claims";
import { describeProviders, zeroPaidKeysReadiness, compareCapabilities } from "@/lib/providers/router";
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

  const coverage = getClaimsCoverage();
  return NextResponse.json({
    ...getCapabilitiesSummary(),
    production: getProductionReadiness(),
    claims: {
      total: coverage.length,
      backed: coverage.filter((c) => c.backed).length,
      coverage,
    },
    providerRouter: {
      adapters: describeProviders(),
      zeroPaidKeys: zeroPaidKeysReadiness(),
      comparison: compareCapabilities(),
    },
  });
}
