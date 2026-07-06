import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getCapabilitiesSummary } from "@/lib/config/capabilities";
import { getProductionReadiness } from "@/lib/config/production";
import { hasIntelligenceApi } from "@/lib/providers/intelligence-api";
import { hasIntegrationEncryptionKey } from "@/lib/security/credential-vault";
import { getSpendSnapshot } from "@/lib/providers/cost-guard";
import { SCAN_ENGINES, getActiveScanEngines, isEngineConfigured } from "@/lib/config/scan-engines";
import { hasCcWebGraphCapability } from "@/lib/providers/ccwebgraph";
import { hasOpenPageRankCapability } from "@/lib/providers/openpagerank";
import { hasCloudflareRadarCapability } from "@/lib/providers/cloudflare-radar";

async function isHealthAuthorized(request: NextRequest): Promise<boolean> {
  const adminSecret = process.env.HEALTH_ADMIN_SECRET;
  if (adminSecret) {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (bearer === adminSecret) return true;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  return Boolean(membership && ["owner", "admin"].includes(membership.role));
}

export async function GET(request: NextRequest) {
  const authorized = await isHealthAuthorized(request);

  if (!authorized) {
    return NextResponse.json({ ok: true, status: "healthy" });
  }

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

  const spend = await getSpendSnapshot().catch(() => null);

  const scanEngineStatus = Object.fromEntries(
    SCAN_ENGINES.map((e) => [e, isEngineConfigured(e) ? "active" : "unavailable"])
  );
  const activeEngines = getActiveScanEngines();

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
      scanEngines: {
        configured: activeEngines,
        all: scanEngineStatus,
        budgetMs: Number(process.env.VISIBILITY_SCAN_BUDGET_MS) || 120000,
        models: {
          openai: process.env.AI_OPENAI_MODEL || "gpt-4o-mini",
          anthropic: process.env.AI_ANTHROPIC_MODEL || "claude-haiku-4-5",
          gemini: process.env.AI_GEMINI_MODEL || "gemini-2.5-flash",
        },
      },
      freeAuthority: {
        ccWebGraph: hasCcWebGraphCapability(),
        openPageRank: hasOpenPageRankCapability(),
        cloudflareRadar: hasCloudflareRadarCapability(),
      },
      providersConfigured: caps.configuredCount,
      activeSerpProvider: caps.activeSerpProvider,
      diyStack: caps.diyStack,
      googleCloud: {
        keyConfigured: caps.freeDataMoat100x.videoSeo,
        pagespeed: caps.freeSignals.realUserCwv,
        cruxHistory: caps.freeDataMoat100x.cwvHistory,
        youtube: caps.freeDataMoat100x.videoSeo,
        knowledgeGraph: caps.freeDataMoat100x.googleKnowledgeGraph,
        naturalLanguage: caps.freeDataMoat100x.googleNaturalLanguage,
      },
      costGuard: spend
        ? {
            day: spend.day,
            dayCostUsd: Math.round(spend.dayCost * 1000) / 1000,
            monthCostUsd: Math.round(spend.monthCost * 1000) / 1000,
            dailyBudgetUsd: spend.dailyBudget,
            monthlyBudgetUsd: spend.monthlyBudget,
            atDailyLimit: spend.atDailyLimit,
            atMonthlyLimit: spend.atMonthlyLimit,
            enabled: !spend.disabled,
          }
        : null,
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
