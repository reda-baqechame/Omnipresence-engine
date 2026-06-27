import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getClarityInsights,
  resolveClarityToken,
  type ClarityInsights,
  type ClarityUrlMetric,
} from "@/lib/providers/clarity";
import { loadProjectIntegration } from "@/lib/integrations/store";
import { logProviderError } from "@/lib/observability/log";

/**
 * Behavioral analytics engine (Phase 1).
 *
 * Turns Microsoft Clarity's free behavioral signals into (a) stored per-URL
 * metrics with provenance, (b) prioritized UX-fix execution tasks, and (c) a
 * 0-100 conversion-readiness signal that feeds the OmniPresence score.
 *
 * Refund-safety: when no Clarity token is connected we return
 * `available:false` / `data_quality:"unavailable"` — never a fabricated zero.
 */

export interface ClarityIntegration extends Record<string, unknown> {
  token?: string;
  clarityProjectId?: string;
}

export interface BehaviorIssue {
  url: string;
  kind: "rage_clicks" | "dead_clicks" | "low_scroll" | "quickback" | "low_engagement";
  severity: "high" | "medium" | "low";
  sessions: number;
  metric: number;
  title: string;
  description: string;
}

export interface BehaviorSummary {
  available: boolean;
  reason?: string;
  data_quality: "measured" | "unavailable";
  totalSessions: number;
  pagesAnalyzed: number;
  issues: BehaviorIssue[];
  /** 0-100 behavioral conversion-readiness signal (undefined when unavailable). */
  conversionSignal?: number;
  last_checked_at?: string;
}

const MIN_SESSIONS_FOR_SIGNAL = 10;

function deriveIssues(urls: ClarityUrlMetric[]): BehaviorIssue[] {
  const issues: BehaviorIssue[] = [];
  for (const u of urls) {
    // Only flag pages with enough traffic to be statistically meaningful.
    if (u.sessions < 5) continue;
    const rageRate = u.sessions ? u.rageClicks / u.sessions : 0;
    const deadRate = u.sessions ? u.deadClicks / u.sessions : 0;
    const quickbackRate = u.sessions ? u.quickbacks / u.sessions : 0;

    if (rageRate >= 0.1) {
      issues.push({
        url: u.url,
        kind: "rage_clicks",
        severity: rageRate >= 0.25 ? "high" : "medium",
        sessions: u.sessions,
        metric: Math.round(rageRate * 100),
        title: `Rage clicks on ${shortUrl(u.url)}`,
        description: `${Math.round(rageRate * 100)}% of ${u.sessions} sessions rage-clicked — a broken/unresponsive element is frustrating users. Inspect the Clarity recording and fix the dead interaction.`,
      });
    }
    if (deadRate >= 0.15) {
      issues.push({
        url: u.url,
        kind: "dead_clicks",
        severity: deadRate >= 0.3 ? "high" : "medium",
        sessions: u.sessions,
        metric: Math.round(deadRate * 100),
        title: `Dead clicks on ${shortUrl(u.url)}`,
        description: `${Math.round(deadRate * 100)}% of sessions clicked an element that does nothing. Make it interactive or remove the false affordance.`,
      });
    }
    if (quickbackRate >= 0.3) {
      issues.push({
        url: u.url,
        kind: "quickback",
        severity: quickbackRate >= 0.5 ? "high" : "medium",
        sessions: u.sessions,
        metric: Math.round(quickbackRate * 100),
        title: `High quickbacks on ${shortUrl(u.url)}`,
        description: `${Math.round(quickbackRate * 100)}% of visitors bounced straight back — the page is not matching intent. Improve the above-the-fold answer and page-speed.`,
      });
    }
    if (typeof u.scrollDepthPct === "number" && u.scrollDepthPct < 35 && u.sessions >= 10) {
      issues.push({
        url: u.url,
        kind: "low_scroll",
        severity: u.scrollDepthPct < 20 ? "high" : "low",
        sessions: u.sessions,
        metric: Math.round(u.scrollDepthPct),
        title: `Low scroll depth on ${shortUrl(u.url)}`,
        description: `Average scroll depth is ${Math.round(u.scrollDepthPct)}%. Move key content/CTAs higher and tighten the intro.`,
      });
    }
    if (typeof u.engagementTimeSec === "number" && u.engagementTimeSec < 8 && u.sessions >= 10) {
      issues.push({
        url: u.url,
        kind: "low_engagement",
        severity: "low",
        sessions: u.sessions,
        metric: Math.round(u.engagementTimeSec),
        title: `Low engagement time on ${shortUrl(u.url)}`,
        description: `Only ${Math.round(u.engagementTimeSec)}s active time. Add depth, internal links, and clearer next steps.`,
      });
    }
  }
  return issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.sessions - a.sessions);
}

function severityRank(s: BehaviorIssue["severity"]): number {
  return s === "high" ? 3 : s === "medium" ? 2 : 1;
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u.startsWith("http") ? u : `https://${u}`);
    return (url.pathname === "/" ? url.hostname : url.pathname).slice(0, 48);
  } catch {
    return u.slice(0, 48);
  }
}

/** Behavioral conversion-readiness on a 0-100 scale (higher = healthier UX). */
function computeConversionSignal(insights: ClarityInsights): number | undefined {
  const meaningful = insights.urls.filter((u) => u.sessions >= MIN_SESSIONS_FOR_SIGNAL);
  if (insights.totalSessions < MIN_SESSIONS_FOR_SIGNAL || meaningful.length === 0) return undefined;

  let weightedRage = 0;
  let weightedQuickback = 0;
  let weightedScroll = 0;
  let scrollWeight = 0;
  let totalWeight = 0;
  for (const u of meaningful) {
    const w = u.sessions;
    totalWeight += w;
    weightedRage += (u.rageClicks / u.sessions) * w;
    weightedQuickback += (u.quickbacks / u.sessions) * w;
    if (typeof u.scrollDepthPct === "number") {
      weightedScroll += u.scrollDepthPct * w;
      scrollWeight += w;
    }
  }
  if (totalWeight === 0) return undefined;

  const rageRate = weightedRage / totalWeight; // 0-1
  const quickbackRate = weightedQuickback / totalWeight; // 0-1
  const scroll = scrollWeight ? weightedScroll / scrollWeight : 50; // 0-100

  // Healthy baseline 100, penalize friction; reward scroll depth.
  let score = 100;
  score -= Math.min(40, rageRate * 200); // 20% rage => -40
  score -= Math.min(30, quickbackRate * 60); // 50% quickback => -30
  score -= Math.max(0, (50 - scroll) * 0.4); // scroll 50% neutral
  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function runBehaviorAnalytics(
  supabase: SupabaseClient,
  input: { projectId: string; organizationId?: string }
): Promise<BehaviorSummary> {
  const integration = await loadProjectIntegration<ClarityIntegration>(
    supabase,
    input.projectId,
    "clarity"
  );
  const token = resolveClarityToken(integration?.token);
  if (!token) {
    return {
      available: false,
      reason: "Connect Microsoft Clarity (free) in Settings to unlock behavioral analytics.",
      data_quality: "unavailable",
      totalSessions: 0,
      pagesAnalyzed: 0,
      issues: [],
    };
  }

  const res = await getClarityInsights(token, 3);
  if (!res.success || !res.data) {
    logProviderError("clarity", res.error, { projectId: input.projectId });
    return {
      available: false,
      reason: res.error || "Clarity request failed.",
      data_quality: "unavailable",
      totalSessions: 0,
      pagesAnalyzed: 0,
      issues: [],
    };
  }

  const insights = res.data;
  const issues = deriveIssues(insights.urls);
  const conversionSignal = computeConversionSignal(insights);
  const nowIso = new Date().toISOString();

  // Persist per-URL metrics (guarded upsert — only when we actually have rows).
  if (insights.urls.length) {
    await supabase.from("behavior_metrics").upsert(
      insights.urls.slice(0, 200).map((u) => ({
        project_id: input.projectId,
        url: u.url,
        sessions: u.sessions,
        scroll_depth_pct: u.scrollDepthPct ?? null,
        engagement_time_sec: u.engagementTimeSec ?? null,
        dead_clicks: u.deadClicks,
        rage_clicks: u.rageClicks,
        quickbacks: u.quickbacks,
        data_source: "measured",
        provider: "microsoft_clarity",
        captured_at: nowIso,
      })),
      { onConflict: "project_id,url" }
    );
  }

  // Materialize UX-fix tasks (dedup on a stable source_id).
  if (issues.length && input.organizationId) {
    await syncBehaviorTasks(supabase, input.projectId, input.organizationId, issues);
  }

  return {
    available: true,
    data_quality: "measured",
    totalSessions: insights.totalSessions,
    pagesAnalyzed: insights.urls.length,
    issues,
    conversionSignal,
    last_checked_at: nowIso,
  };
}

async function syncBehaviorTasks(
  supabase: SupabaseClient,
  projectId: string,
  organizationId: string,
  issues: BehaviorIssue[]
): Promise<void> {
  const { data: existing } = await supabase
    .from("execution_tasks")
    .select("source_id")
    .eq("project_id", projectId)
    .eq("source_module", "behavior");
  const existingIds = new Set((existing || []).map((e) => e.source_id));

  const rows = issues
    .filter((i) => i.severity !== "low")
    .map((i) => {
      const sourceId = `${i.kind}:${i.url}`;
      return { sourceId, issue: i };
    })
    .filter((r) => !existingIds.has(r.sourceId))
    .map((r) => ({
      project_id: projectId,
      organization_id: organizationId,
      title: r.issue.title,
      description: r.issue.description,
      source_module: "behavior" as const,
      source_id: r.sourceId,
      category: "ux",
      priority: r.issue.severity === "high" ? "high" : "medium",
      impact: r.issue.severity === "high" ? 65 : 40,
      effort: 2,
      status: "todo" as const,
    }));

  if (rows.length) {
    await supabase.from("execution_tasks").insert(rows);
  }
}
