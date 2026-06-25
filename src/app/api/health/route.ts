import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getCapabilitiesSummary } from "@/lib/config/capabilities";
import { getProductionReadiness } from "@/lib/config/production";
import { hasIntegrationEncryptionKey } from "@/lib/security/credential-vault";

export async function GET() {
  const caps = getCapabilitiesSummary();
  const production = getProductionReadiness();
  const checks: Record<string, "ok" | "error" | "skipped" | "warning"> = {
    supabase: "skipped",
    stripe: "skipped",
    inngest: "skipped",
    omnidata: "skipped",
    integration_encryption: hasIntegrationEncryptionKey() ? "ok" : production.blockers.includes("integration_encryption") ? "error" : "warning",
    live_data: caps.liveData ? "ok" : "skipped",
    citation_tracking: caps.citationTracking ? "ok" : "skipped",
    serp: caps.serpCapability ? "ok" : "skipped",
    llm_mentions: caps.dataForSeoFallback ? "ok" : "skipped",
  };

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const supabase = await createServiceClient();
      const { error } = await supabase.from("organizations").select("id").limit(1);
      checks.supabase = error ? "error" : "ok";
    } catch {
      checks.supabase = "error";
    }
  }

  if (process.env.STRIPE_SECRET_KEY) {
    checks.stripe = "ok";
  }

  if (process.env.INNGEST_EVENT_KEY) {
    checks.inngest = "ok";
  }

  if (process.env.OMNIDATA_BASE_URL) {
    try {
      const base = process.env.OMNIDATA_BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
      checks.omnidata = res.ok ? "ok" : "error";
    } catch {
      checks.omnidata = "error";
    }
  }

  const healthy = checks.supabase !== "error" && production.ready;

  return NextResponse.json(
    {
      status: healthy ? "healthy" : "degraded",
      version: caps.version,
      engines: caps.engines,
      providersConfigured: caps.configuredCount,
      activeSerpProvider: caps.activeSerpProvider,
      diyStack: caps.diyStack,
      production: {
        ready: production.ready,
        score: production.score,
        blockers: production.blockers,
        warnings: production.warnings,
      },
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
