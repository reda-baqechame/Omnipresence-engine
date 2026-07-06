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
  const adapters = await describeProviders();
  return NextResponse.json({
    ...getCapabilitiesSummary(),
    production: getProductionReadiness(),
    claims: {
      total: coverage.length,
      backed: coverage.filter((c) => c.backed).length,
      coverage,
    },
    providerRouter: {
      adapters,
      // Operator signal: providers the circuit breaker is currently fast-failing
      // (open) or trialing (half-open) so a degraded upstream is visible at a glance.
      degraded: adapters
        .filter((a) => a.circuit !== "closed")
        .map((a) => ({ id: a.id, capability: a.capability, circuit: a.circuit, failures: a.failures })),
      zeroPaidKeys: zeroPaidKeysReadiness(),
      comparison: compareCapabilities(),
    },
  });
}
