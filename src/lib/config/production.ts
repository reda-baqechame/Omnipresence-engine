import {
  getCapabilitiesSummary,
  hasSerpCapability,
  preferLiveData,
} from "@/lib/config/capabilities";
import { hasIntelligenceApi } from "@/lib/providers/intelligence-api";
import { hasIntegrationEncryptionKey } from "@/lib/security/credential-vault";

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
    process.env.VERCEL_ENV === "preview"
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
    id: "live_data",
    label: "Live visibility & SERP data",
    status: preferLiveData() ? "ok" : "warning",
    message: "Add SERPER or OMNIDATA + at least one LLM key for real scans",
  });

  checks.push({
    id: "serp",
    label: "SERP provider",
    status: hasSerpCapability() ? "ok" : "warning",
    message: "SERPER, BRAVE, or OMNIDATA_BASE_URL",
  });

  checks.push({
    id: "inngest",
    label: "Background jobs (Inngest)",
    status:
      hasEnv("INNGEST_EVENT_KEY") && hasEnv("INNGEST_SIGNING_KEY") ? "ok" : "warning",
    message: "Scans, crons, guarantee verify, publish scheduler",
  });

  checks.push({
    id: "omnidata",
    label: "OmniData engine",
    status: hasEnv("OMNIDATA_BASE_URL")
      ? hasEnv("OMNIDATA_API_KEY") && hasEnv("OMNIDATA_SIGNING_SECRET")
        ? "ok"
        : "warning"
      : "skipped",
    message: "Self-hosted SERP/rank/backlinks — recommended for production volume",
  });

  checks.push({
    id: "intelligence_api",
    label: "Keyword & gap intelligence API",
    status: hasIntelligenceApi() ? "ok" : preferLiveData() ? "warning" : "skipped",
    message: "OMNIDATA_BASE_URL or SERPER for keyword research, content gaps, backlink gaps",
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
    status: hasEnv("RESEND_API_KEY") ? "ok" : "skipped",
    message: "Audit leads and weekly reports",
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
