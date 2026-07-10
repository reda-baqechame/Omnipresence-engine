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
  clusterStrikingDistanceByTargetUrl,
  enrichStrikingDistanceWithClusters,
  mineCannibalizationOpportunities,
} from "@/lib/engines/searchops-gsc-miner";
import {
  mineCanonicalMismatchOpportunities,
  mineCwvOpportunities,
  mineInternalLinkOpportunities,
  mineSchemaGapOpportunities,
} from "@/lib/engines/searchops-technical-miner";
import { mineAiVisibilityOpportunities } from "@/lib/engines/searchops-ai-visibility-miner";
import { mineAuthorityOpportunities } from "@/lib/engines/searchops-authority-miner";
import {
  isReportQualityBlockCriticalEnabled,
  isReportQualitySanitizeEnabled,
} from "@/lib/engines/report-quality-flags";

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
  relatedQueries?: string[];
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
 * Convert stored/live GSC insight buckets into opportunity rows (measured only).
 */
export function mineGscOpportunitiesFromInsights(insights: {
  strikingDistance?: Array<{
    query: string;
    impressions: number;
    clicks: number;
    ctr: number;
    position: number;
  }>;
  lowCtr?: Array<{
    query: string;
    impressions: number;
    clicks: number;
    ctr: number;
    position: number;
  }>;
  decay?: Array<{ url: string; currImpressions: number; prevImpressions: number }>;
}): GscOpp[] {
  const fromStrike = mineGscOpportunitiesFromQueryRows(insights.strikingDistance || []);
  const fromLow = (insights.lowCtr || []).map(
    (q): GscOpp => ({
      kind: "low_ctr",
      queryOrUrl: q.query,
      impressions: q.impressions,
      clicks: q.clicks,
      ctr: q.ctr,
      position: q.position,
    })
  );
  const fromDecay = (insights.decay || []).slice(0, 10).map(
    (d): GscOpp => ({
      kind: "decay",
      queryOrUrl: d.url,
      impressions: d.currImpressions,
      clicks: undefined,
      position: undefined,
    })
  );
  const seen = new Set<string>();
  return [...fromStrike, ...fromLow, ...fromDecay]
    .filter((o) => {
      const key = `${o.kind}:${o.queryOrUrl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 25);
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

  // SSR-safe: only Supabase reads + in-process aggregation. No live GSC /
  // OmniData / paid provider calls on page render (avoids 504s + spend).
  const [
    { data: scores },
    { data: findings },
    { data: coverage },
    visibilitySnapshot,
    { data: tasks },
    { data: oauthRows },
    { data: rqRows },
    { data: rankKeywords },
    { data: backlinkGraphSnaps },
    { data: backlinkSnap },
    { data: gscSnap },
    { data: gscQueryRows },
    { data: cwvHistory },
    { data: internalLinkRows },
    { data: crawlPages },
    { data: sourceOpportunities },
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
      .select("keyword, last_position, is_striking_distance, cannibalization_urls, target_url")
      .eq("project_id", id)
      .order("last_position", { ascending: true })
      .limit(80),
    supabase
      .from("backlink_graph_snapshots")
      .select(
        "referring_domains, total_links, new_count, lost_count, data_source, created_at, intersection"
      )
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(2),
    supabase
      .from("backlink_snapshots")
      .select("total_count, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("gsc_snapshots")
      .select("clicks, impressions, ctr, avg_position, captured_on, data_source")
      .eq("project_id", id)
      .order("captured_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Latest day's query rows only (SSR-safe; populated by explicit GSC refresh).
    supabase
      .from("gsc_query_snapshots")
      .select("dimension, key, clicks, impressions, ctr, position, captured_on, data_source")
      .eq("project_id", id)
      .eq("dimension", "query")
      .order("captured_on", { ascending: false })
      .order("impressions", { ascending: false })
      .limit(80),
    supabase
      .from("cwv_history")
      .select("collected_on, lcp_ms, inp_ms, cls, data_source")
      .eq("project_id", id)
      .order("collected_on", { ascending: false })
      .limit(10),
    supabase
      .from("internal_link_opportunities")
      .select("id, source_url, target_url, anchor_suggestion, relevance_score, status")
      .eq("project_id", id)
      .order("relevance_score", { ascending: false })
      .limit(25),
    supabase
      .from("crawl_pages")
      .select("url, canonical")
      .eq("project_id", id)
      .limit(200),
    supabase
      .from("source_opportunities")
      .select(
        "id, source_domain, opportunity_type, competitor_citations, influence_score, recommended_action, tactic, evidence, status, brand_present"
      )
      .eq("project_id", id)
      .order("influence_score", { ascending: false })
      .limit(40),
  ]);
  const backlinkGraphSnap = backlinkGraphSnaps?.[0] ?? null;

  const latestScore = scores?.[scores.length - 1] ?? null;
  const measuredDims = latestScore
    ? SCORE_DIMENSION_KEYS.filter((k) => isSubScoreAvailable(latestScore, k)).length
    : 0;
  const dataConfidenceScore = latestScore
    ? Math.round((measuredDims / SCORE_DIMENSION_KEYS.length) * 100)
    : null;

  const grounded = visibilitySnapshot.groundedResults;
  const aiRate = visibilitySnapshot.ratesReliable ? visibilitySnapshot.metrics.mentionRate : null;
  // Headline rates are measured only when grounded probes are reliable — never
  // mark "measured" quality while withholding the rate as null.
  const aiDq: DataQuality =
    visibilitySnapshot.ratesReliable && grounded.length > 0 && aiRate != null ? "measured" : "unavailable";

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

  // Prefer stored graph snapshot; fall back to legacy backlink_snapshots count.
  // Never live-fetch OmniData/DataForSEO during SSR.
  let authDomains: number | null = null;
  let authDq: DataQuality = "unavailable";
  let authSource = "backlink_graph_snapshots";
  let authFreshness: string | null = null;
  if (
    backlinkGraphSnap &&
    backlinkGraphSnap.data_source !== "unavailable" &&
    backlinkGraphSnap.referring_domains != null &&
    Number(backlinkGraphSnap.referring_domains) >= 0
  ) {
    authDomains = Number(backlinkGraphSnap.referring_domains);
    const ds = String(backlinkGraphSnap.data_source || "measured").toLowerCase();
    authDq =
      ds === "estimated" || ds === "model_knowledge" || ds === "simulated"
        ? (ds as DataQuality)
        : "measured";
    authFreshness = backlinkGraphSnap.created_at ?? null;
  } else if (backlinkSnap && backlinkSnap.total_count != null && Number(backlinkSnap.total_count) >= 0) {
    // Legacy count is a proxy — do not label as measured referring domains.
    authDomains = Number(backlinkSnap.total_count);
    authDq = "estimated";
    authSource = "backlink_snapshots";
    authFreshness = backlinkSnap.created_at ?? null;
  } else if (latestScore && isSubScoreAvailable(latestScore, "authority_mentions")) {
    metrics.push({
      id: "authority",
      label: "Authority mentions score",
      value: latestScore.authority_mentions,
      display: String(Math.round(latestScore.authority_mentions)),
      status: "measured",
      source: "scores.authority_mentions",
      freshness: latestScore.created_at,
      confidence: 0.7,
      evidenceHref: `${base}/authority`,
    });
  }

  if (authDq === "unavailable" && !metrics.some((m) => m.id === "authority")) {
    metrics.push(
      metricUnavailable(
        "authority",
        "Authority / referring domains",
        "No stored backlink snapshot yet — unavailable, not zero. Open Backlinks to refresh the index.",
        `${base}/backlinks`
      )
    );
  } else if (authDq !== "unavailable" && authDomains != null) {
    metrics.push({
      id: "authority",
      label:
        authSource === "backlink_snapshots"
          ? "Backlink count (legacy snapshot)"
          : "Referring domains (snapshot)",
      value: authDomains,
      display: String(authDomains),
      status: authDq === "estimated" ? "estimated" : "measured",
      source: authSource,
      freshness: authFreshness,
      confidence: 0.8,
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
  // Rank-tracker + persisted gsc_query_snapshots on SSR. Live Google calls only
  // on explicit refresh — never block page render on GSC APIs.
  const rankRows = rankKeywords || [];
  const minedRanks = mineGscOpportunitiesFromRanks(rankRows);
  const latestQueryDay = gscQueryRows?.[0]?.captured_on ?? null;
  const sameDayQueries = (gscQueryRows || []).filter(
    (r) => r.captured_on === latestQueryDay && r.data_source === "measured"
  );
  const fromSnapshots = mineGscOpportunitiesFromQueryRows(
    sameDayQueries.map((r) => ({
      query: r.key,
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.ctr != null ? Number(r.ctr) : null,
      position: r.position != null ? Number(r.position) : null,
    }))
  );
  const strikeBase = fromSnapshots.length
    ? (() => {
        const gscKeys = new Set(fromSnapshots.map((o) => o.queryOrUrl.toLowerCase()));
        const rankOnly = minedRanks.filter((o) => !gscKeys.has(o.queryOrUrl.toLowerCase()));
        return [...fromSnapshots, ...rankOnly].slice(0, 25);
      })()
    : minedRanks;
  const strikeQueries = strikeBase
    .filter((o) => o.kind === "striking_distance")
    .map((o) => o.queryOrUrl);
  const pageClusters = clusterStrikingDistanceByTargetUrl(rankRows, strikeQueries);
  const gscOpportunities: GscOpp[] = enrichStrikingDistanceWithClusters(
    strikeBase,
    pageClusters,
    rankRows
  );

  const hasCrawlData = (crawlPages || []).length > 0 || (internalLinkRows || []).length > 0;
  const aiDeep = mineAiVisibilityOpportunities(
    id,
    visibilitySnapshot.scopedResults || visibilitySnapshot.groundedResults || [],
    project.domain || "",
    { ratesReliable: visibilitySnapshot.ratesReliable }
  );
  const authorityDeep = mineAuthorityOpportunities(id, {
    graphSnaps: backlinkGraphSnaps || [],
    legacyTotalCount: backlinkSnap?.total_count ?? null,
    sourceOpportunities: sourceOpportunities || [],
    // Engine still emits unavailable when no RD; miner adds stale/velocity/gaps.
    emitUnavailableCard: false,
  });
  const extraOpportunities: SearchOpsOpportunity[] = [
    ...mineCannibalizationOpportunities(id, rankRows),
    ...mineCwvOpportunities(id, cwvHistory || []),
    ...mineSchemaGapOpportunities(id, findings || []),
    ...mineInternalLinkOpportunities(id, internalLinkRows || [], hasCrawlData),
    ...mineCanonicalMismatchOpportunities(id, crawlPages || []),
    ...aiDeep,
    ...authorityDeep,
  ];

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
      affected_url: f.affected_url ?? null,
      fix_recommendation: f.fix_recommendation ?? null,
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
    extraOpportunities,
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
