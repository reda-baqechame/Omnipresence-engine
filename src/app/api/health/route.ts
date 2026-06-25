import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getCapabilitiesSummary } from "@/lib/config/capabilities";

export async function GET() {
  const caps = getCapabilitiesSummary();
  const checks: Record<string, "ok" | "error" | "skipped"> = {
    supabase: "skipped",
    stripe: "skipped",
    inngest: "skipped",
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

  const healthy = checks.supabase !== "error";

  return NextResponse.json(
    {
      status: healthy ? "healthy" : "degraded",
      version: caps.version,
      engines: caps.engines,
      providersConfigured: caps.configuredCount,
      activeSerpProvider: caps.activeSerpProvider,
      diyStack: caps.diyStack,
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
