import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiForbidden, apiUnauthorized } from "@/lib/security/api-response";
import { describeProviders } from "@/lib/providers/router";
import { getCapabilitiesSummary } from "@/lib/config/capabilities";

const CAPABILITY_LABELS: Record<string, string> = {
  ai_visibility: "AI Visibility",
  search_visibility: "Search Visibility",
  local_visibility: "Local SEO",
  social_presence: "Social Presence",
  directory_coverage: "Directory Coverage",
  authority_mentions: "Authority & Backlinks",
  technical_readiness: "Technical SEO",
  conversion_readiness: "Conversion Readiness",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const access = await verifyProjectAccess(supabase, id, user.id, "viewer");
  if (!access) return apiForbidden();

  const [
    { data: latestScore },
    { data: qualityScore },
    { data: visibility },
    { data: ranks },
    { data: attribution },
    { data: gsc },
  ] = await Promise.all([
    supabase
      .from("scores")
      .select("breakdown, created_at, data_source, confidence, provider")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("data_quality_scores")
      .select("*")
      .eq("project_id", id)
      .order("captured_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("visibility_results").select("data_source, provider, created_at").eq("project_id", id).limit(50),
    supabase.from("rank_keywords").select("last_rank_source, last_confidence, last_checked_at").eq("project_id", id).limit(20),
    supabase
      .from("attribution_metrics")
      .select("data_source, provider, is_estimated, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("gsc_snapshots")
      .select("data_source, captured_on")
      .eq("project_id", id)
      .order("captured_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const availability = (latestScore?.breakdown as { dimension_availability?: Record<string, boolean> } | null)
    ?.dimension_availability;

  const dimensions = Object.entries(CAPABILITY_LABELS).map(([key, label]) => ({
    key,
    label,
    available: availability?.[key] ?? false,
    status: availability?.[key] ? "measured" : "unavailable",
  }));

  const measuredVisibility = (visibility || []).filter((v) => v.data_source === "measured").length;
  const allProviders = await describeProviders();
  const providers = allProviders.filter((p) => p.usableNow);
  // Honesty fix (P2): previously silently dropped — a user had no way to see
  // which sovereign/paid data sources are registered but NOT wired up, only
  // the ones that happened to be active. List each missing one with why.
  const missingProviders = allProviders
    .filter((p) => !p.usableNow)
    .map((p) => ({
      id: p.id,
      capability: p.capability,
      reason: !p.enabled
        ? p.paid
          ? "Paid provider — API key not configured"
          : "Not configured"
        : p.category === "benchmark_only"
          ? "Benchmark-only — never used for live results"
          : "Disabled in Zero-Paid-Keys mode",
    }));
  const caps = getCapabilitiesSummary();

  return NextResponse.json({
    dimensions,
    dataQualityScore: qualityScore,
    lastScoreAt: latestScore?.created_at,
    scoreProvenance: {
      dataSource: latestScore?.data_source,
      confidence: latestScore?.confidence,
      provider: latestScore?.provider,
    },
    signals: {
      visibility: {
        total: visibility?.length || 0,
        measured: measuredVisibility,
        status: measuredVisibility > 0 ? "measured" : visibility?.length ? "mixed" : "unavailable",
      },
      ranks: {
        tracked: ranks?.length || 0,
        lastChecked: ranks?.[0]?.last_checked_at,
        source: ranks?.[0]?.last_rank_source,
        confidence: ranks?.[0]?.last_confidence,
      },
      attribution: attribution
        ? {
            dataSource: attribution.data_source,
            provider: attribution.provider,
            isEstimated: attribution.is_estimated,
            status: attribution.is_estimated ? "estimated" : "measured",
          }
        : { status: "unavailable" },
      gsc: gsc ? { dataSource: gsc.data_source, capturedOn: gsc.captured_on, status: "measured" } : { status: "unavailable" },
    },
    activeProviders: providers.map((p) => ({
      id: p.id,
      capability: p.capability,
      confidence: p.confidence,
      circuit: p.circuit,
    })),
    missingProviders,
    platform: {
      liveData: caps.liveData,
      serpProvider: caps.activeSerpProvider,
      configuredProviders: caps.configuredCount,
    },
    contractUrl: "/docs/DATA_CONTRACT.md",
  });
}
