/**
 * Prompt-panel runner (Wave O2).
 *
 * Executes a panel as a real statistical experiment:
 *   prompts × engines × geos × personas × runs_per_prompt
 * Then aggregates with Wilson confidence intervals on mention/citation/share-of-
 * voice and a cross-cell volatility index, with sample-size gating so we never
 * publish a "score" below a credible sample. Cost is bounded per plan tier by
 * trimming the matrix BEFORE any provider call is made.
 *
 * This is the engine that turns "we asked ChatGPT once" into defensible numbers.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runVisibilityScan,
  persistProbeTraces,
  wilsonInterval,
  type VisibilityScanResult,
} from "@/lib/engines/visibility-scanner";
import {
  clampRuns,
  sanitizeEngines,
  type PromptPanel,
  type PromptPanelMember,
} from "@/lib/engines/prompt-panels";
import { getOrganizationPlan, getPanelCellLimit } from "@/lib/plans/limits";
import { logProviderError } from "@/lib/observability/log";

/** Minimum measured observations before a headline rate is considered credible. */
export const MIN_PANEL_SAMPLE = 8;

export interface PanelRunSummary {
  panelRunId: string | null;
  sampleSize: number;
  sufficientSample: boolean;
  mentionRate: number | null;
  mentionCi: { low: number; high: number } | null;
  citationRate: number | null;
  shareOfVoice: number | null;
  volatilityIndex: number | null;
  enginesMeasured: number;
  cellsTotal: number;
  trimmed: boolean;
}

interface ProjectRow {
  id: string;
  name: string;
  domain: string;
  competitors: string[] | null;
  organization_id: string;
}

/** A single measured observation reduced to what aggregation needs. */
interface Observation {
  cellKey: string;
  engine: string;
  brandMentioned: boolean;
  brandCited: boolean;
  grounded: boolean;
  competitorMentions: number;
}

function isMeasured(r: VisibilityScanResult): boolean {
  return r.data_source !== "simulated" && r.measurement_mode !== "unavailable";
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Trim a panel's matrix knobs so total cells stay within the plan budget.
 * Reduces runs first (cheapest signal to lose), then trims member count.
 */
function applyCostCap(
  panel: Pick<PromptPanel, "geos" | "personas" | "engines" | "runs_per_prompt">,
  memberCount: number,
  cellLimit: number
): { runs: number; members: number; trimmed: boolean } {
  const engines = sanitizeEngines(panel.engines).length;
  const geos = panel.geos.length || 1;
  const personas = panel.personas.length || 1;
  const perRunPerMember = engines * geos * personas;

  let runs = clampRuns(panel.runs_per_prompt);
  let members = memberCount;
  let trimmed = false;

  while (members * perRunPerMember * runs > cellLimit && runs > 1) {
    runs -= 1;
    trimmed = true;
  }
  while (members * perRunPerMember * runs > cellLimit && members > 1) {
    members -= 1;
    trimmed = true;
  }
  return { runs, members, trimmed };
}

/**
 * Run one panel end-to-end and persist an `ai_panel_runs` summary + probe traces.
 * Best-effort persistence: a storage hiccup never loses the computed stats from
 * the returned summary.
 */
export async function runPromptPanel(
  supabase: SupabaseClient,
  panelId: string
): Promise<PanelRunSummary> {
  const { data: panel, error: panelErr } = await supabase
    .from("ai_prompt_panels")
    .select("id, project_id, name, geos, personas, engines, runs_per_prompt, is_active")
    .eq("id", panelId)
    .single();
  if (panelErr || !panel) throw new Error("panel_not_found");

  const { data: members } = await supabase
    .from("ai_prompt_panel_members")
    .select("prompt_text, prompt_id")
    .eq("panel_id", panelId);
  const memberRows = (members || []) as Pick<PromptPanelMember, "prompt_text" | "prompt_id">[];
  if (!memberRows.length) throw new Error("panel_has_no_prompts");

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, domain, competitors, organization_id")
    .eq("id", panel.project_id)
    .single();
  if (!project) throw new Error("project_not_found");
  const proj = project as ProjectRow;

  const plan = await getOrganizationPlan(supabase, proj.organization_id);
  const cellLimit = getPanelCellLimit(plan);

  const cap = applyCostCap(panel, memberRows.length, cellLimit);
  const cappedMembers = memberRows.slice(0, cap.members);

  const engines = sanitizeEngines(panel.engines);
  const geos = panel.geos.length ? panel.geos : ["United States"];
  const personas = panel.personas.length ? panel.personas : [null];
  const runId = crypto.randomUUID();

  const observations: Observation[] = [];
  const allResults: VisibilityScanResult[] = [];
  // Per-cell mention accumulator for the volatility index.
  const cellMentions = new Map<string, { hits: number; n: number }>();

  for (const geo of geos) {
    for (const persona of personas) {
      for (let run = 0; run < cap.runs; run++) {
        let results: VisibilityScanResult[] = [];
        try {
          results = await runVisibilityScan({
            projectId: proj.id,
            runId,
            brandName: proj.name,
            brandDomain: proj.domain,
            competitors: proj.competitors || [],
            location: geo,
            persona: persona ?? undefined,
            engines,
            prompts: cappedMembers.map((m) => ({ id: m.prompt_id ?? undefined, text: m.prompt_text })),
            maxPrompts: cappedMembers.length,
          });
        } catch (err) {
          logProviderError("panel.run_cell_failed", err, { panelId, geo, persona, run });
          continue;
        }
        for (const r of results) {
          allResults.push(r);
          if (!isMeasured(r)) continue;
          const cellKey = `${r.prompt_text}::${r.engine}::${geo}::${persona ?? ""}`;
          const competitorMentions = Object.values(r.competitor_mentions || {}).filter(Boolean).length;
          observations.push({
            cellKey,
            engine: r.engine,
            brandMentioned: Boolean(r.brand_mentioned),
            brandCited: Boolean(r.brand_cited),
            grounded: r.measurement_mode === "grounded",
            competitorMentions,
          });
          const acc = cellMentions.get(cellKey) || { hits: 0, n: 0 };
          acc.hits += r.brand_mentioned ? 1 : 0;
          acc.n += 1;
          cellMentions.set(cellKey, acc);
        }
      }
    }
  }

  const sampleSize = observations.length;
  const sufficientSample = sampleSize >= MIN_PANEL_SAMPLE;

  const mentionHits = observations.filter((o) => o.brandMentioned).length;
  const groundedObs = observations.filter((o) => o.grounded);
  const citationHits = groundedObs.filter((o) => o.brandCited).length;
  const brandMentionTotal = mentionHits;
  const competitorMentionTotal = observations.reduce((a, o) => a + o.competitorMentions, 0);

  const mentionRate = sampleSize ? mentionHits / sampleSize : null;
  const mentionCi = sampleSize ? wilsonInterval(mentionHits, sampleSize) : null;
  const citationRate = groundedObs.length ? citationHits / groundedObs.length : null;
  const shareOfVoice =
    brandMentionTotal + competitorMentionTotal > 0
      ? brandMentionTotal / (brandMentionTotal + competitorMentionTotal)
      : null;

  // Volatility = dispersion of per-cell mention rates (0 = perfectly stable).
  const cellRates = [...cellMentions.values()].filter((c) => c.n > 0).map((c) => c.hits / c.n);
  const volatilityIndex = cellRates.length >= 2 ? Number(stddev(cellRates).toFixed(4)) : 0;

  const enginesMeasured = new Set(observations.map((o) => o.engine)).size;
  const cellsTotal = cellMentions.size;

  const stats = {
    by_engine: aggregateByEngine(observations),
    grounded_observations: groundedObs.length,
    min_sample: MIN_PANEL_SAMPLE,
    cost_cap: { plan, cell_limit: cellLimit, trimmed: cap.trimmed, runs: cap.runs, members: cap.members },
  };

  let panelRunId: string | null = null;
  try {
    const { data: inserted } = await supabase
      .from("ai_panel_runs")
      .insert({
        panel_id: panelId,
        project_id: proj.id,
        run_id: runId,
        sample_size: sampleSize,
        sufficient_sample: sufficientSample,
        mention_rate: mentionRate,
        mention_ci_low: mentionCi?.low ?? null,
        mention_ci_high: mentionCi?.high ?? null,
        citation_rate: citationRate,
        share_of_voice: shareOfVoice,
        volatility_index: volatilityIndex,
        engines_measured: enginesMeasured,
        cells_total: cellsTotal,
        stats,
      })
      .select("id")
      .single();
    panelRunId = inserted?.id ?? null;
  } catch (err) {
    logProviderError("panel.summary_insert_failed", err, { panelId });
  }

  // Persist probe traces (carries persona/geo) + bump last_run_at. Best-effort.
  await persistProbeTraces(supabase as never, allResults).catch(() => 0);
  await supabase
    .from("ai_prompt_panels")
    .update({ last_run_at: new Date().toISOString() })
    .eq("id", panelId)
    .then(undefined, () => undefined);

  return {
    panelRunId,
    sampleSize,
    sufficientSample,
    mentionRate,
    mentionCi,
    citationRate,
    shareOfVoice,
    volatilityIndex,
    enginesMeasured,
    cellsTotal,
    trimmed: cap.trimmed,
  };
}

function aggregateByEngine(observations: Observation[]): Record<string, { n: number; mention_rate: number }> {
  const out: Record<string, { n: number; mention_rate: number }> = {};
  const byEngine = new Map<string, { hits: number; n: number }>();
  for (const o of observations) {
    const acc = byEngine.get(o.engine) || { hits: 0, n: 0 };
    acc.hits += o.brandMentioned ? 1 : 0;
    acc.n += 1;
    byEngine.set(o.engine, acc);
  }
  for (const [engine, acc] of byEngine) {
    out[engine] = { n: acc.n, mention_rate: acc.n ? Number((acc.hits / acc.n).toFixed(4)) : 0 };
  }
  return out;
}
