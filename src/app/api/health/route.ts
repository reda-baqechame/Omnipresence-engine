import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getCapabilitiesSummary } from "@/lib/config/capabilities";
import { getProductionReadiness } from "@/lib/config/production";
import { hasIntelligenceApi } from "@/lib/providers/intelligence-api";
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
    intelligence_schema: "skipped" as const,
    phase8_schema: "skipped" as const,
    phase9_schema: "skipped" as const,
    phase10_schema: "skipped" as const,
    intelligence_api: hasIntelligenceApi() ? "ok" : caps.liveData ? "warning" : "skipped",
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

      const { error: intelErr } = await supabase
        .from("keyword_opportunities")
        .select("id")
        .limit(1);
      checks.intelligence_schema =
        intelErr?.message?.includes("does not exist") || intelErr?.code === "42P01"
          ? "error"
          : intelErr
            ? "warning"
            : "ok";

      const { error: phase8Err } = await supabase.from("url_indexing_log").select("id").limit(1);
      checks.phase8_schema =
        phase8Err?.message?.includes("does not exist") || phase8Err?.code === "42P01"
          ? "error"
          : phase8Err
            ? "warning"
            : "ok";

      const { error: phase9Err } = await supabase.from("visitor_sessions").select("id").limit(1);
      checks.phase9_schema =
        phase9Err?.message?.includes("does not exist") || phase9Err?.code === "42P01"
          ? "error"
          : phase9Err
            ? "warning"
            : "ok";

      const { error: phase10Err } = await supabase.from("aeo_readiness").select("id").limit(1);
      checks.phase10_schema =
        phase10Err?.message?.includes("does not exist") || phase10Err?.code === "42P01"
          ? "error"
          : phase10Err
            ? "warning"
            : "ok";
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

  const healthy =
    checks.supabase !== "error" &&
    checks.intelligence_schema !== "error" &&
    checks.phase8_schema !== "error" &&
    checks.phase9_schema !== "error" &&
    checks.phase10_schema !== "error" &&
    production.ready;

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
        checks: production.checks,
      },
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
