import type { SupabaseClient } from "@supabase/supabase-js";
import { recordLedgerAction } from "@/lib/engines/results-ledger";

/**
 * Measured GEO rewrite loop (the headline result).
 *
 *   baseline citation rate  ->  AutoGEO answer-first rewrite  ->  deploy
 *   ->  re-probe after N days  ->  measure citation/mention lift  ->  ledger
 *
 * Everything is computed from the real `ai_probe_traces` history (Phase 3), so
 * the lift we report to the customer is a genuine before/after measurement, not
 * a claim. That measured delta is what makes the guarantee defensible.
 */

export interface CitationRateWindow {
  probes: number;
  mentions: number;
  citations: number;
  mentionRate: number;
  citationRate: number;
}

interface ProbeTraceLite {
  brand_mentioned: boolean;
  brand_cited: boolean;
  data_source: string | null;
}

/**
 * Citation/mention rate over a time window from ai_probe_traces. Only countable
 * probes (measured + model_knowledge) are included so an unavailable probe never
 * deflates the rate. Optionally scoped to a set of prompts.
 */
export async function measureCitationRate(
  supabase: SupabaseClient,
  projectId: string,
  opts: { sinceISO: string; untilISO?: string; prompts?: string[] }
): Promise<CitationRateWindow> {
  let query = supabase
    .from("ai_probe_traces")
    .select("brand_mentioned, brand_cited, data_source")
    .eq("project_id", projectId)
    .gte("checked_at", opts.sinceISO);

  if (opts.untilISO) query = query.lt("checked_at", opts.untilISO);
  if (opts.prompts && opts.prompts.length) query = query.in("prompt", opts.prompts);

  const { data } = await query;
  const rows = ((data || []) as ProbeTraceLite[]).filter(
    (r) => r.data_source === "measured" || r.data_source === "model_knowledge"
  );
  const probes = rows.length;
  const mentions = rows.filter((r) => r.brand_mentioned).length;
  const citations = rows.filter((r) => r.brand_cited).length;
  return {
    probes,
    mentions,
    citations,
    mentionRate: probes ? mentions / probes : 0,
    citationRate: probes ? citations / probes : 0,
  };
}

export interface RewriteLiftSummary {
  before: CitationRateWindow;
  after: CitationRateWindow;
  citationLiftPp: number;
  mentionLiftPp: number;
}

export function computeLift(before: CitationRateWindow, after: CitationRateWindow): RewriteLiftSummary {
  return {
    before,
    after,
    citationLiftPp: Math.round((after.citationRate - before.citationRate) * 1000) / 10,
    mentionLiftPp: Math.round((after.mentionRate - before.mentionRate) * 1000) / 10,
  };
}

/** Record the baseline ledger entry when a rewrite is deployed (status in_progress). */
export async function recordRewriteBaseline(
  supabase: SupabaseClient,
  projectId: string,
  url: string,
  before: CitationRateWindow
): Promise<{ id: string } | null> {
  return recordLedgerAction(supabase, {
    project_id: projectId,
    action_type: "geo_rewrite",
    action_surface: "content",
    description: `AutoGEO answer-first rewrite deployed for ${url}; measuring citation lift`,
    baseline_snapshot: {
      url,
      citation_rate: before.citationRate,
      mention_rate: before.mentionRate,
      probes: before.probes,
      data_source: "measured",
    },
    outcome_snapshot: {},
    status: "in_progress",
  });
}

/** Finalize the ledger entry with the measured before/after lift. */
export async function recordRewriteLift(
  supabase: SupabaseClient,
  projectId: string,
  url: string,
  lift: RewriteLiftSummary
): Promise<void> {
  await recordLedgerAction(supabase, {
    project_id: projectId,
    action_type: "geo_rewrite_measured",
    action_surface: "content",
    description: `Measured AI citation lift for ${url}: ${lift.citationLiftPp >= 0 ? "+" : ""}${lift.citationLiftPp}pp citations, ${lift.mentionLiftPp >= 0 ? "+" : ""}${lift.mentionLiftPp}pp mentions`,
    baseline_snapshot: {
      citation_rate: lift.before.citationRate,
      mention_rate: lift.before.mentionRate,
      probes: lift.before.probes,
    },
    outcome_snapshot: {
      citation_rate: lift.after.citationRate,
      mention_rate: lift.after.mentionRate,
      probes: lift.after.probes,
      data_source: "measured",
    },
    delta_summary: {
      citation_lift_pp: lift.citationLiftPp,
      mention_lift_pp: lift.mentionLiftPp,
    },
    status: lift.citationLiftPp > 0 || lift.mentionLiftPp > 0 ? "verified" : "completed",
  });
}
