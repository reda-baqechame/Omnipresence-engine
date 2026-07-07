import {
  getCapabilitiesSummary,
  hasSerpCapability,
  preferLiveData,
  hasDirectLLMCapability,
  activeAIEngines,
} from "@/lib/config/capabilities";
import { hasIntelligenceApi } from "@/lib/providers/intelligence-api";
import { hasIntegrationEncryptionKey } from "@/lib/security/credential-vault";
import { hasResendCapability, hasSmtpCapability } from "@/lib/email/transport";

export type ProductionCheckStatus = "ok" | "warning" | "error" | "skipped";

export interface ProductionCheck {
  id: string;
  label: string;
  status: ProductionCheckStatus;
  message?: string;
}

function hasEnv(key: string): boolean {
  const v = process.env[key];
  return Boolean(v && v.length > 0 && !v.startsWith("your-"));
}

export function isProductionDeploy(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview" ||
    // Railway is a first-class deploy target: its env is present for every
    // service (app, omnidata, worker) so the fail-fast guards activate there too.
    Boolean(process.env.RAILWAY_ENVIRONMENT)
  );
}

export function getProductionReadiness(): {
  ready: boolean;
  score: number;
  checks: ProductionCheck[];
  blockers: string[];
  warnings: string[];
} {
  const checks: ProductionCheck[] = [];

  checks.push({
    id: "supabase",
    label: "Supabase database",
    status:
      hasEnv("NEXT_PUBLIC_SUPABASE_URL") && hasEnv("SUPABASE_SERVICE_ROLE_KEY")
        ? "ok"
        : "error",
    message: "Required for auth, projects, and all persisted data",
  });

  checks.push({
    id: "app_url",
    label: "Public app URL",
    status: hasEnv("NEXT_PUBLIC_APP_URL") ? "ok" : "warning",
    message: "Needed for OAuth redirects and email links",
  });

  checks.push({
    id: "oauth_secret",
    label: "OAuth state secret",
    status: hasEnv("OAUTH_STATE_SECRET") ? "ok" : "error",
    message: "Required for GSC/Bing/GA4 OAuth security",
  });

  checks.push({
    id: "upstash",
    label: "Distributed rate limiting (Upstash Redis)",
    status:
      hasEnv("UPSTASH_REDIS_REST_URL") && hasEnv("UPSTASH_REDIS_REST_TOKEN")
        ? "ok"
        : isProductionDeploy()
          ? "error"
          : "warning",
    message:
      "Required in production — without Upstash, rate limits are per-instance and bypassable",
  });

  checks.push({
    id: "live_data",
    label: "Live visibility & SERP data",
    status: preferLiveData() ? "ok" : isProductionDeploy() ? "error" : "warning",
    message: "Add SERPER or OMNIDATA + at least one LLM key for real scans",
  });

  if (process.env.FORCE_DEMO_MODE === "true" && isProductionDeploy()) {
    checks.push({
      id: "demo_mode",
      label: "Demo mode disabled in production",
      status: "error",
      message: "Remove FORCE_DEMO_MODE on Vercel — production must deliver measured results",
    });
  }

  checks.push({
    id: "serp",
    label: "SERP provider",
    status: hasSerpCapability() ? "ok" : "warning",
    message: "SERPER, BRAVE, or OMNIDATA_BASE_URL",
  });

  const aiEngines = activeAIEngines();
  checks.push({
    id: "ai_engines",
    label: "Generative AI engines",
    status: hasDirectLLMCapability() ? "ok" : "warning",
    message: aiEngines.length
      ? `Live: ${aiEngines.join(", ")}`
      : "Add OPENAI/ANTHROPIC/GOOGLE_GENERATIVE_AI key for true AI-answer probes (SERP/AI-Overview still measured without one)",
  });

  // The cost guard is always-on in code; this surfaces that paid LLM spend is
  // bounded so an operator can trust adding keys won't run up an open-ended bill.
  checks.push({
    id: "cost_guard",
    label: "LLM cost guard",
    status: process.env.LLM_BUDGET_DISABLED === "true" ? "warning" : "ok",
    message:
      process.env.LLM_BUDGET_DISABLED === "true"
        ? "Disabled — paid LLM spend is NOT capped (set LLM_BUDGET_DISABLED!=true)"
        : `Daily $${process.env.LLM_DAILY_BUDGET_USD || 5} / monthly $${process.env.LLM_MONTHLY_BUDGET_USD || 50} cap enforced`,
  });

  checks.push({
    id: "inngest",
    label: "Background jobs (Inngest)",
    status:
      hasEnv("INNGEST_EVENT_KEY") && hasEnv("INNGEST_SIGNING_KEY") ? "ok" : "warning",
    message: "Scans, crons, guarantee verify, publish scheduler",
  });

  const omnidataInsecureKey =
    process.env.OMNIDATA_API_KEY === "dev-local-key" ||
    (process.env.OMNIDATA_API_KEY?.length ?? 0) < 24;
  const omnidataRemote =
    hasEnv("OMNIDATA_BASE_URL") &&
    !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(process.env.OMNIDATA_BASE_URL || "");
  checks.push({
    id: "omnidata",
    label: "OmniData engine",
    status: !hasEnv("OMNIDATA_BASE_URL")
      ? "skipped"
      : omnidataRemote && isProductionDeploy() && omnidataInsecureKey
        ? "error"
        : hasEnv("OMNIDATA_API_KEY") && hasEnv("OMNIDATA_SIGNING_SECRET")
          ? "ok"
          : "warning",
    message:
      omnidataRemote && omnidataInsecureKey
        ? "Insecure key: set a strong OMNIDATA_API_KEY (24+ chars, not 'dev-local-key') + OMNIDATA_SIGNING_SECRET — a remote OmniData with the dev key is an open data endpoint"
        : "Self-hosted SERP/rank/backlinks — recommended for production volume",
  });

  checks.push({
    id: "intelligence_api",
    label: "Keyword & gap intelligence API",
    status: hasIntelligenceApi() ? "ok" : preferLiveData() ? "warning" : "skipped",
    message: "OMNIDATA, DataForSEO, or SERPER for keyword research, content gaps, backlink gaps",
  });

  checks.push({
    id: "integration_encryption",
    label: "Integration credential encryption",
    status: hasIntegrationEncryptionKey()
      ? "ok"
      : isProductionDeploy()
        ? "error"
        : "warning",
    message: "Set INTEGRATION_ENCRYPTION_KEY (32+ chars) on Vercel before saving CMS credentials",
  });

  checks.push({
    id: "phase8_execution",
    label: "Phase 8 execution tables",
    status: hasEnv("NEXT_PUBLIC_SUPABASE_URL") ? "ok" : "skipped",
    message: "url_indexing_log, link_building_orders, community_mentions — run 0016 migration",
  });

  checks.push({
    id: "phase9_identity",
    label: "Phase 9 visitor identity",
    status: hasEnv("NEXT_PUBLIC_SUPABASE_URL") ? "ok" : "skipped",
    message: "visitor_sessions — run 0017 migration",
  });

  checks.push({
    id: "clearbit",
    label: "Clearbit visitor enrichment",
    status: hasEnv("CLEARBIT_REVEAL_KEY") ? "ok" : "skipped",
    message: "Optional — enriches beacon sessions with company data",
  });

  checks.push({
    id: "indexnow",
    label: "IndexNow URL discovery",
    status: hasEnv("INDEXNOW_KEY") ? "ok" : "skipped",
    message: "Faster indexing after publish",
  });

  checks.push({
    id: "stripe",
    label: "Stripe billing",
    status:
      process.env.FREE_ACCESS_MODE === "true"
        ? "skipped"
        : hasEnv("STRIPE_SECRET_KEY") && hasEnv("STRIPE_WEBHOOK_SECRET")
          ? "ok"
          : "warning",
    message: "Optional when FREE_ACCESS_MODE=true",
  });

  checks.push({
    id: "email",
    label: "Transactional email",
    status: hasResendCapability() || hasSmtpCapability() ? "ok" : "skipped",
    message: hasResendCapability()
      ? "Resend — audit leads and weekly reports (custom domain unlocks delivery to any inbox)"
      : hasSmtpCapability()
        ? "SMTP — audit leads and weekly reports"
        : "Set RESEND_API_KEY or SMTP_HOST for audit lead emails",
  });

  const blockers = checks.filter((c) => c.status === "error").map((c) => c.id);
  const warnings = checks.filter((c) => c.status === "warning").map((c) => c.id);
  const scored = checks.filter((c) => c.status !== "skipped");
  const okCount = scored.filter((c) => c.status === "ok").length;
  const score = scored.length ? Math.round((okCount / scored.length) * 100) : 0;

  return {
    ready: blockers.length === 0,
    score,
    checks,
    blockers,
    warnings,
  };
}

export function getProductionSummary() {
  const caps = getCapabilitiesSummary();
  const readiness = getProductionReadiness();
  return {
    ...caps,
    production: readiness,
  };
}
