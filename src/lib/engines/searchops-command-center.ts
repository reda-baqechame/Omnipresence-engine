/**
 * SearchOps Command Center data loader — aggregates existing project signals
 * into a professional visibility command snapshot. No paid provider calls.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DataQuality, ExecutionTask, Project } from "@/types/database";
import { loadProjectVisibilitySnapshot } from "@/lib/engines/visibility-scope";
import { describeProviders } from "@/lib/providers/router";
import { isSubScoreAvailable, SCORE_DIMENSION_KEYS } from "@/lib/scoring/subscore-availability";
import {
  buildSearchOpsOpportunities,
  type SearchOpsOpportunity,
} from "@/lib/engines/searchops-opportunity-engine";
import {
  isReportQualityBlockCriticalEnabled,
  isReportQualitySanitizeEnabled,
} from "@/lib/engines/report-quality-flags";
import { fetchBacklinks } from "@/lib/providers/capability-runners";
import { getValidOAuthToken } from "@/lib/oauth/tokens";
import { fetchGscTopQueries } from "@/lib/engines/gsc-queries";

export type MetricStatus = "measured" | "estimated" | "unavailable" | "simulated" | "model_knowledge";

export interface CommandMetricCard {
  id: string;
  label: string;
  value: string | number | null;
  display: string;
  status: MetricStatus;
  source: string | null;
  freshness: string | null;
  confidence: number | null;
  whyUnavailable?: string | null;
  evidenceHref?: string | null;
}

export interface DataSourceHealthRow {
  id: string;
  label: string;
  kind: "official" | "internal" | "fallback";
  status: "connected" | "disconnected" | "unavailable" | "fallback_only" | "active";
  lastCollected: string | null;
  confidence: number | null;
  note: string;
}

export interface ExecutionStatusSummary {
  todo: number;
  inProgress: number;
  done: number;
  awaitingVerification: number;
  verified: number;
  dismissed: number;
}

export interface ReportQualityStatusSummary {
  sanitizeEnabled: boolean;
  blockCriticalEnabled: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  latestAt: string | null;
}

export interface SearchOpsCommandCenter {
  projectId: string;
  projectName: string;
  domain: string;
  metrics: CommandMetricCard[];
  dataSources: DataSourceHealthRow[];
  opportunities: SearchOpsOpportunity[];
  execution: ExecutionStatusSummary;
  reportQuality: ReportQualityStatusSummary;
  dataConfidenceScore: number | null;
  generatedAt: string;
}

function metricUnavailable(id: string, label: string, why: string, evidenceHref?: string): CommandMetricCard {
  return {
    id,
    label,
    value: null,
    display: "Unavailable",
    status: "unavailable",
    source: null,
    freshness: null,
    confidence: null,
    whyUnavailable: why,
    evidenceHref: evidenceHref ?? null,
  };
}

type GscOpp = {
  kind: "striking_distance" | "low_ctr" | "decay";
  queryOrUrl: string;
  impressions: number;
  clicks?: number;
  ctr?: number;
  position?: number;
};

/**
 * Mine SERP/GSC-adjacent opportunities from measured rank_keywords.
 * Uses position + striking-distance flags only (no invented impressions).
 */
export function mineGscOpportunitiesFromRanks(
  rows: Array<{
    keyword?: string | null;
    last_position?: number | null;
    is_striking_distance?: boolean | null;
  }>
): GscOpp[] {
  const out: GscOpp[] = [];
  for (const row of rows) {
    const q = String(row.keyword || "").trim();
    if (!q) continue;
    const pos = Number(row.last_position);
    if (!Number.isFinite(pos) || pos <= 0) continue;
    if (row.is_striking_distance || (pos > 3 && pos <= 20)) {
      out.push({
        kind: "striking_distance",
        queryOrUrl: q,
        // Impressions unknown without GSC — leave 0 and let diagnosis use position.
        impressions: 0,
        position: pos,
      });
    }
  }
  return out.slice(0, 20);
}

/** Expected organic CTR by average position (heuristic for prioritization only). */
function expectedCtrForPosition(position: number): number {
  if (position <= 1) return 0.28;
  if (position <= 2) return 0.15;
  if (position <= 3) return 0.1;
  if (position <= 5) return 0.06;
  if (position <= 10) return 0.025;
  return 0.01;
}

/**
 * Mine first-party GSC query opportunities from measured Search Analytics rows.
 * Never invents impressions — rows with no measured impressions are skipped.
 */
export function mineGscOpportunitiesFromQueryRows(
  rows: Array<{
    query?: string | null;
    impressions?: number | null;
    clicks?: number | null;
    ctr?: number | null;
    position?: number | null;
  }>,
  opts: { minImpressions?: number } = {}
): GscOpp[] {
  const minImpressions = opts.minImpressions ?? 50;
  const out: GscOpp[] = [];
  for (const row of rows) {
    const q = String(row.query || "").trim();
    const impressions = Number(row.impressions);
    const position = Number(row.position);
    const clicks = Number(row.clicks ?? 0);
    const ctr = Number(row.ctr ?? (impressions > 0 ? clicks / impressions : 0));
    if (!q || !Number.isFinite(impressions) || impressions < minImpressions) continue;
    if (!Number.isFinite(position) || position <= 0) continue;

    if (position > 3 && position <= 15) {
      out.push({
        kind: "striking_distance",
        queryOrUrl: q,
        impressions,
        clicks,
        ctr,
        position,
      });
    }

    const target = expectedCtrForPosition(position);
    if (ctr < target * 0.5 && impressions >= minImpressions) {
      out.push({
        kind: "low_ctr",
        queryOrUrl: q,
        impressions,
        clicks,
        ctr,
        position,
      });
    }
  }
  // Prefer high-impression rows; dedupe by kind+query
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.impressions - a.impressions)
    .filter((o) => {
      const key = `${o.kind}:${o.queryOrUrl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

export async function loadSearchOpsCommandCenter(
  supabase: SupabaseClient,
  project: Project
): Promise<SearchOpsCommandCenter> {
  const id = project.id;
  const base = `/app/projects/${id}`;

  const [
    { data: scores },
    { data: findings },
    { data: coverage },
    visibilitySnapshot,
    { data: tasks },
    { data: oauthRows },
    { data: rqRows },
    { data: rankKeywords },
  ] = await Promise.all([
    supabase.from("scores").select("*").eq("project_id", id).order("created_at", { ascending: true }),
    supabase.from("technical_findings").select("*").eq("project_id", id).order("severity"),
    supabase.from("coverage_items").select("*").eq("project_id", id),
    loadProjectVisibilitySnapshot(supabase, id, project.name, project.competitors || []),
    supabase.from("execution_tasks").select("*").eq("project_id", id),
    supabase.from("oauth_connections").select("provider, updated_at, expires_at").eq("project_id", id),
    supabase
      .from("report_quality_violations")
      .select("severity, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("rank_keywords")
      .select("keyword, last_position, is_striking_distance")
      .eq("project_id", id)
      .order("last_position", { ascending: true })
      .limit(80),
  ]);

  const latestScore = scores?.[scores.length - 1] ?? null;
  const measuredDims = latestScore
    ? SCORE_DIMENSION_KEYS.filter((k) => isSubScoreAvailable(latestScore, k)).length
    : 0;
  const dataConfidenceScore = latestScore
    ? Math.round((measuredDims / SCORE_DIMENSION_KEYS.length) * 100)
    : null;

  const grounded = visibilitySnapshot.groundedResults;
  const aiRate = visibilitySnapshot.ratesReliable ? visibilitySnapshot.metrics.mentionRate : null;
  const aiDq: DataQuality = grounded.length ? "measured" : "unavailable";

  const sov = visibilitySnapshot.sov?.brand?.shareOfVoice ?? null;
  const sovDq: DataQuality =
    visibilitySnapshot.ratesReliable && sov != null ? "measured" : "unavailable";

  const metrics: CommandMetricCard[] = [];

  if (aiRate == null || !visibilitySnapshot.ratesReliable) {
    metrics.push(
      metricUnavailable(
        "ai_visibility",
        "AI visibility rate",
        visibilitySnapshot.reliabilityNote ||
          "Insufficient grounded probes — unavailable, not zero.",
        `${base}/ai-visibility`
      )
    );
  } else {
    metrics.push({
      id: "ai_visibility",
      label: "AI visibility rate",
      value: aiRate,
      display: `${(aiRate * 100).toFixed(1)}%`,
      status: "measured",
      source: "visibility_results (grounded)",
      freshness: visibilitySnapshot.latestRun?.completed_at || visibilitySnapshot.latestRun?.created_at || null,
      confidence: grounded.length >= 10 ? 0.85 : 0.55,
      evidenceHref: `${base}/ai-visibility`,
    });
  }

  if (latestScore && isSubScoreAvailable(latestScore, "search_visibility")) {
    metrics.push({
      id: "search_visibility",
      label: "Search visibility",
      value: latestScore.search_visibility,
      display: String(Math.round(latestScore.search_visibility)),
      status: "measured",
      source: "scores.search_visibility",
      freshness: latestScore.created_at,
      confidence: 0.8,
      evidenceHref: `${base}/search-performance`,
    });
  } else {
    metrics.push(
      metricUnavailable(
        "search_visibility",
        "Search visibility",
        "No measured search visibility score yet.",
        `${base}/gsc`
      )
    );
  }

  if (sov == null || sovDq !== "measured") {
    metrics.push(
      metricUnavailable(
        "share_of_voice",
        "Share of voice",
        "SoV requires reliable grounded AI probes.",
        `${base}/ai-visibility`
      )
    );
  } else {
    metrics.push({
      id: "share_of_voice",
      label: "Share of voice",
      value: sov,
      display: `${(sov * 100).toFixed(1)}%`,
      status: "measured",
      source: "share_of_voice",
      freshness: visibilitySnapshot.latestRun?.completed_at || null,
      confidence: 0.8,
      evidenceHref: `${base}/ai-visibility`,
    });
  }

  metrics.push(
    metricUnavailable(
      "ads_replacement",
      "Ads-replacement value",
      "Shown only from ROI/report paths with labeled CPC provenance — not fabricated here.",
      `${base}/roi`
    )
  );

  if (latestScore && isSubScoreAvailable(latestScore, "technical_readiness")) {
    metrics.push({
      id: "technical_health",
      label: "Technical health",
      value: latestScore.technical_readiness,
      display: String(Math.round(latestScore.technical_readiness)),
      status: "measured",
      source: "scores.technical_readiness",
      freshness: latestScore.created_at,
      confidence: 0.85,
      evidenceHref: `${base}/technical`,
    });
  } else {
    metrics.push(
      metricUnavailable("technical_health", "Technical health", "No technical score yet.", `${base}/technical`)
    );
  }

  const missingCoverage = (coverage || []).filter(
    (c) => !c.is_present && c.data_quality !== "unavailable" && c.data_source !== "unavailable"
  );
  metrics.push({
    id: "content_coverage",
    label: "Content coverage gaps",
    value: coverage?.length ? missingCoverage.length : null,
    display: coverage?.length ? String(missingCoverage.length) : "Unavailable",
    status: coverage?.length ? "measured" : "unavailable",
    source: "coverage_items",
    freshness: null,
    confidence: coverage?.length ? 0.7 : null,
    whyUnavailable: coverage?.length ? null : "No coverage scan data.",
    evidenceHref: `${base}/coverage`,
  });

  let authDomains: number | null = null;
  let authDq: DataQuality = "unavailable";
  try {
    const bl = await fetchBacklinks(project.domain, 25);
    if (bl.success && bl.data) {
      authDomains = bl.data.length;
      authDq = "measured";
    }
  } catch {
    authDq = "unavailable";
  }

  if (authDq === "unavailable" || authDomains == null) {
    metrics.push(
      metricUnavailable(
        "authority",
        "Authority / referring domains",
        "No sovereign backlink index result — unavailable, not zero.",
        `${base}/backlinks`
      )
    );
  } else {
    metrics.push({
      id: "authority",
      label: "Referring domains (sample)",
      value: authDomains,
      display: String(authDomains),
      status: "measured",
      source: "fetchBacklinks / OmniData webgraph",
      freshness: new Date().toISOString(),
      confidence: 0.75,
      evidenceHref: `${base}/backlinks`,
    });
  }

  if (latestScore && isSubScoreAvailable(latestScore, "local_visibility")) {
    metrics.push({
      id: "local_visibility",
      label: "Local visibility",
      value: latestScore.local_visibility,
      display: String(Math.round(latestScore.local_visibility)),
      status: "measured",
      source: "scores.local_visibility",
      freshness: latestScore.created_at,
      confidence: 0.7,
      evidenceHref: `${base}/local`,
    });
  } else {
    metrics.push(
      metricUnavailable("local_visibility", "Local visibility", "No measured local score.", `${base}/local`)
    );
  }

  metrics.push({
    id: "data_confidence",
    label: "Data confidence score",
    value: dataConfidenceScore,
    display: dataConfidenceScore == null ? "Unavailable" : `${dataConfidenceScore}%`,
    status: dataConfidenceScore == null ? "unavailable" : "measured",
    source: "score dimension availability",
    freshness: latestScore?.created_at ?? null,
    confidence: dataConfidenceScore == null ? null : 0.9,
    whyUnavailable: dataConfidenceScore == null ? "No score row yet." : null,
    evidenceHref: `${base}/trust`,
  });

  const providers = await describeProviders();
  const oauthByProvider = new Map((oauthRows || []).map((r) => [String(r.provider), r]));

  const dataSources: DataSourceHealthRow[] = [
    {
      id: "gsc",
      label: "Google Search Console",
      kind: "official",
      status: oauthByProvider.has("google_search_console") ? "connected" : "disconnected",
      lastCollected: oauthByProvider.get("google_search_console")?.updated_at || null,
      confidence: oauthByProvider.has("google_search_console") ? 0.99 : null,
      note: "First-party clicks/impressions when connected",
    },
    {
      id: "ga4",
      label: "GA4",
      kind: "official",
      status: oauthByProvider.has("google_analytics") ? "connected" : "disconnected",
      lastCollected: oauthByProvider.get("google_analytics")?.updated_at || null,
      confidence: oauthByProvider.has("google_analytics") ? 0.95 : null,
      note: "Sessions/conversions when property configured",
    },
    {
      id: "bing",
      label: "Bing Webmaster",
      kind: "official",
      status: oauthByProvider.has("bing_webmaster") ? "connected" : "disconnected",
      lastCollected: oauthByProvider.get("bing_webmaster")?.updated_at || null,
      confidence: null,
      note: "Official Bing metrics when connected",
    },
    {
      id: "omnidata",
      label: "OmniData / crawler",
      kind: "internal",
      status: providers.some((p) => p.id.includes("omnidata") && p.usableNow) ? "active" : "unavailable",
      lastCollected: null,
      confidence: 0.8,
      note: "Sovereign crawl / SERP / webgraph",
    },
    {
      id: "webgraph",
      label: "Common Crawl webgraph",
      kind: "internal",
      status: providers.some((p) => p.capability === "backlinks" && p.usableNow) ? "active" : "unavailable",
      lastCollected: null,
      confidence: 0.75,
      note: "Referring domains when ingested",
    },
    {
      id: "ai_probes",
      label: "AI visibility probes",
      kind: "internal",
      status: grounded.length > 0 ? "active" : "unavailable",
      lastCollected: visibilitySnapshot.latestRun?.completed_at || null,
      confidence: grounded.length >= 10 ? 0.85 : grounded.length > 0 ? 0.5 : null,
      note: "Grounded probes only count as measured",
    },
    {
      id: "dataforseo",
      label: "DataForSEO",
      kind: "fallback",
      status: providers.some((p) => p.id.startsWith("dataforseo") && p.usableNow)
        ? "fallback_only"
        : "unavailable",
      lastCollected: null,
      confidence: null,
      note: "Patch J: fallback_only / benchmark_only — not primary",
    },
  ];

  const taskList = (tasks || []) as ExecutionTask[];
  const execution: ExecutionStatusSummary = {
    todo: taskList.filter((t) => t.status === "todo").length,
    inProgress: taskList.filter((t) => t.status === "in_progress").length,
    done: taskList.filter((t) => t.status === "done").length,
    awaitingVerification: taskList.filter((t) => t.status === "done" && !t.verified_at).length,
    verified: taskList.filter((t) => t.status === "verified" || Boolean(t.verified_at)).length,
    dismissed: taskList.filter((t) => t.status === "dismissed").length,
  };

  const rq = rqRows || [];
  const reportQuality: ReportQualityStatusSummary = {
    sanitizeEnabled: isReportQualitySanitizeEnabled(),
    blockCriticalEnabled: isReportQualityBlockCriticalEnabled(),
    errorCount: rq.filter((r) => r.severity === "error").length,
    warningCount: rq.filter((r) => r.severity === "warning").length,
    infoCount: rq.filter((r) => r.severity === "info").length,
    latestAt: rq[0]?.created_at ?? null,
  };

  const gscConnected = dataSources.find((d) => d.id === "gsc")?.status === "connected";
  let gscOpportunities = mineGscOpportunitiesFromRanks(rankKeywords || []);

  // Optional data improvement A: first-party GSC query mining when OAuth is live.
  // Cache-free live read; empty on failure — never invent impressions.
  if (gscConnected) {
    try {
      const token = await getValidOAuthToken(supabase, id, "google_search_console");
      if (token) {
        const end = new Date();
        const start = new Date(end.getTime() - 28 * 24 * 60 * 60 * 1000);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        const queryRows = await fetchGscTopQueries(token, project.domain, fmt(start), fmt(end), 200);
        const fromGsc = mineGscOpportunitiesFromQueryRows(queryRows);
        if (fromGsc.length) {
          // Prefer measured GSC rows; keep rank-only striking distance for queries not in GSC.
          const gscKeys = new Set(fromGsc.map((o) => o.queryOrUrl.toLowerCase()));
          const rankOnly = gscOpportunities.filter((o) => !gscKeys.has(o.queryOrUrl.toLowerCase()));
          gscOpportunities = [...fromGsc, ...rankOnly].slice(0, 25);
        }
      }
    } catch {
      // Keep rank_keywords mining only.
    }
  }

  // Surface GSC snapshot totals on search visibility when available (measured only).
  const { data: gscSnap } = await supabase
    .from("gsc_snapshots")
    .select("clicks, impressions, ctr, avg_position, captured_on, data_source")
    .eq("project_id", id)
    .order("captured_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (gscSnap && gscSnap.impressions != null && Number(gscSnap.impressions) >= 0) {
    const idx = metrics.findIndex((m) => m.id === "search_visibility");
    const card: CommandMetricCard = {
      id: "gsc_clicks",
      label: "GSC clicks (latest snapshot)",
      value: gscSnap.clicks,
      display: gscSnap.clicks == null ? "Unavailable" : String(gscSnap.clicks),
      status: gscSnap.clicks == null ? "unavailable" : "measured",
      source: "gsc_snapshots",
      freshness: gscSnap.captured_on,
      confidence: 0.95,
      whyUnavailable: gscSnap.clicks == null ? "Snapshot missing clicks." : null,
      evidenceHref: `${base}/gsc`,
    };
    if (idx >= 0) metrics.splice(idx + 1, 0, card);
    else metrics.push(card);
  } else if (gscConnected) {
    metrics.push(
      metricUnavailable(
        "gsc_clicks",
        "GSC clicks (latest snapshot)",
        "GSC connected but no gsc_snapshots row yet — sync required.",
        `${base}/gsc`
      )
    );
  }

  const opportunities = buildSearchOpsOpportunities({
    projectId: id,
    brandName: project.name,
    aiMentionRate: aiRate,
    aiSampleSize: grounded.length,
    aiDataQuality: aiDq,
    shareOfVoice: sov,
    sovDataQuality: sovDq,
    technicalFindings: (findings || []).map((f) => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      category: f.category,
      data_quality: (f.data_source || f.data_quality) as DataQuality | undefined,
    })),
    coverageGaps: (coverage || []).map((c) => ({
      id: c.id,
      title: c.platform_name || c.surface,
      surface: c.surface,
      is_present: c.is_present,
      data_quality: (c.data_quality || c.data_source) as DataQuality | undefined,
    })),
    gscConnected,
    gscOpportunities,
    authorityReferringDomains: authDomains,
    authorityDataQuality: authDq,
    reportQualityErrorCount: reportQuality.errorCount,
    existingTasks: taskList.map((t) => ({ title: t.title, status: t.status })),
  });

  return {
    projectId: id,
    projectName: project.name,
    domain: project.domain,
    metrics,
    dataSources,
    opportunities,
    execution,
    reportQuality,
    dataConfidenceScore,
    generatedAt: new Date().toISOString(),
  };
}
