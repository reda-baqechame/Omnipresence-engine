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

/**
 * Statistics policy (Phase 0, Master Plan v4):
 *  - >= 30 measured observations before a rate is even DIRECTIONAL;
 *  - >= 50 before a rate is a client-facing HEADLINE number;
 *  - >= 30 per engine before engine-level trends are shown;
 *  - >= 3 identical repeated runs per prompt/engine cell (repeatability is the
 *    product promise — trimming protects runs, see applyCostCap).
 */
export const MIN_PANEL_SAMPLE_DIRECTIONAL = 30;
export const MIN_PANEL_SAMPLE_HEADLINE = 50;
export const MIN_ENGINE_SAMPLE = 30;
export const MIN_RUNS_PER_CELL = 3;
/** Back-compat gate: "sufficient" now means the directional threshold. */
export const MIN_PANEL_SAMPLE = MIN_PANEL_SAMPLE_DIRECTIONAL;

/**
 * Volatility decomposed by source (Phase 0): model randomness across repeated
 * runs is NOT the same phenomenon as disagreement between engines, prompts,
 * geographies or personas — reporting them as one number was misleading.
 */
export interface VolatilityBreakdown {
  /** Within-cell dispersion across repeated identical runs (model randomness). */
  repeatedRun: number | null;
  /** Dispersion of per-prompt mention rates. */
  prompt: number | null;
  /** Dispersion of per-engine mention rates (engine disagreement). */
  engine: number | null;
  /** Dispersion of per-geography mention rates. */
  geo: number | null;
  /** Dispersion of per-persona mention rates. */
  persona: number | null;
}

export interface PanelRunSummary {
  panelRunId: string | null;
  sampleSize: number;
  sufficientSample: boolean;
  /** headline (>=50) | directional (>=30) | insufficient (<30). */
  sampleTier: "headline" | "directional" | "insufficient";
  mentionRate: number | null;
  mentionCi: { low: number; high: number } | null;
  citationRate: number | null;
  shareOfVoice: number | null;
  /** Repeated-run volatility (the honest headline number). */
  volatilityIndex: number | null;
  volatility: VolatilityBreakdown;
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
  promptText: string;
  geo: string;
  persona: string | null;
  brandMentioned: boolean;
  brandCited: boolean;
  grounded: boolean;
  competitorMentions: number;
}

/**
 * Strict measured classification (Phase 0): only rows the pipeline actually
 * MEASURED count toward panel statistics. Estimated/model-knowledge/simulated/
 * unavailable rows are all excluded — "not simulated" was too broad a bar for
 * receipt-grade numbers.
 */
function isMeasured(r: VisibilityScanResult): boolean {
  return r.data_source === "measured";
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

interface CostCapResult {
  engines: ReturnType<typeof sanitizeEngines>;
  geos: string[];
  personas: (string | null)[];
  runs: number;
  members: number;
  trimmed: boolean;
  /** What was cut, in order — recorded on the run so trimming is never silent. */
  trimSteps: string[];
}

/**
 * Trim a panel's matrix so total cells stay within the plan budget.
 *
 * Trimming order (Phase 0 statistics policy): personas → geos → engines →
 * prompts, and only as an absolute last resort repeated runs. Repeatability is
 * the product promise, so runs are PROTECTED (floor MIN_RUNS_PER_CELL) — the
 * old behavior of shedding runs first optimized away exactly the signal we
 * sell. Every cut is recorded in trimSteps so the run is honestly marked.
 */
function applyCostCap(
  panel: Pick<PromptPanel, "geos" | "personas" | "engines" | "runs_per_prompt">,
  memberCount: number,
  cellLimit: number
): CostCapResult {
  let engines = sanitizeEngines(panel.engines);
  let geos = panel.geos.length ? [...panel.geos] : ["United States"];
  let personas: (string | null)[] = panel.personas.length ? [...panel.personas] : [null];
  let runs = Math.max(MIN_RUNS_PER_CELL, clampRuns(panel.runs_per_prompt));
  let members = memberCount;
  const trimSteps: string[] = [];

  const total = () => members * engines.length * geos.length * personas.length * runs;

  while (total() > cellLimit && personas.length > 1) {
    personas = personas.slice(0, -1);
    trimSteps.push("persona");
  }
  while (total() > cellLimit && geos.length > 1) {
    geos = geos.slice(0, -1);
    trimSteps.push("geo");
  }
  while (total() > cellLimit && engines.length > 1) {
    engines = engines.slice(0, -1);
    trimSteps.push("engine");
  }
  while (total() > cellLimit && members > 1) {
    members -= 1;
    trimSteps.push("prompt");
  }
  // Last resort only: sacrificing repeatability beats refusing to run at all,
  // but the run is marked trimmed and the runs floor is 1, never 0.
  while (total() > cellLimit && runs > 1) {
    runs -= 1;
    trimSteps.push("runs");
  }

  return { engines, geos, personas, runs, members, trimmed: trimSteps.length > 0, trimSteps };
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

  const engines = cap.engines;
  const geos = cap.geos;
  const personas = cap.personas;
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
          const scan = await runVisibilityScan({
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
            // Panels measure repeated-run variance — every run must be a fresh
            // provider call. Served-from-cache repeats would report fake zero
            // volatility (the exact dishonesty this product exists to kill).
            probeCacheMode: "record",
          });
          results = scan.results;
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
            promptText: r.prompt_text,
            geo,
            persona: persona ?? null,
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
  const sampleTier: PanelRunSummary["sampleTier"] =
    sampleSize >= MIN_PANEL_SAMPLE_HEADLINE
      ? "headline"
      : sampleSize >= MIN_PANEL_SAMPLE_DIRECTIONAL
        ? "directional"
        : "insufficient";
  const sufficientSample = sampleSize >= MIN_PANEL_SAMPLE_DIRECTIONAL;

  const mentionHits = observations.filter((o) => o.brandMentioned).length;
  // Citation rate is receipt-grade only over GROUNDED measured observations —
  // an ungrounded API answer can't prove what was actually cited.
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

  // Volatility separated by source (Phase 0): repeated-run randomness is the
  // headline; prompt/engine/geo/persona dispersion are different phenomena
  // and are reported as such, never blended into one number.
  const volatility = computeVolatilityBreakdown(observations, cellMentions);
  const volatilityIndex = volatility.repeatedRun;

  const enginesMeasured = new Set(observations.map((o) => o.engine)).size;
  const cellsTotal = cellMentions.size;

  const stats = {
    by_engine: aggregateByEngine(observations),
    grounded_observations: groundedObs.length,
    sample_tier: sampleTier,
    min_sample_directional: MIN_PANEL_SAMPLE_DIRECTIONAL,
    min_sample_headline: MIN_PANEL_SAMPLE_HEADLINE,
    min_engine_sample: MIN_ENGINE_SAMPLE,
    min_runs_per_cell: MIN_RUNS_PER_CELL,
    volatility: {
      repeated_run: volatility.repeatedRun,
      prompt: volatility.prompt,
      engine: volatility.engine,
      geo: volatility.geo,
      persona: volatility.persona,
    },
    cost_cap: {
      plan,
      cell_limit: cellLimit,
      trimmed: cap.trimmed,
      trim_steps: cap.trimSteps,
      runs: cap.runs,
      members: cap.members,
      engines: cap.engines.length,
      geos: cap.geos.length,
      personas: cap.personas.length,
    },
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
    sampleTier,
    mentionRate,
    mentionCi,
    citationRate,
    shareOfVoice,
    volatilityIndex,
    volatility,
    enginesMeasured,
    cellsTotal,
    trimmed: cap.trimmed,
  };
}

/** Dispersion (stddev) of group mention rates for one grouping dimension. */
function groupRateDispersion(
  observations: Observation[],
  keyOf: (o: Observation) => string
): number | null {
  const groups = new Map<string, { hits: number; n: number }>();
  for (const o of observations) {
    const key = keyOf(o);
    const acc = groups.get(key) || { hits: 0, n: 0 };
    acc.hits += o.brandMentioned ? 1 : 0;
    acc.n += 1;
    groups.set(key, acc);
  }
  const rates = [...groups.values()].filter((g) => g.n > 0).map((g) => g.hits / g.n);
  if (rates.length < 2) return null;
  return Number(stddev(rates).toFixed(4));
}

/**
 * Separate volatility by its source. `repeatedRun` is the mean within-cell
 * stddev across identical repeated runs (pure model randomness); the others
 * are between-group dispersions of mention rates.
 */
function computeVolatilityBreakdown(
  observations: Observation[],
  cellMentions: Map<string, { hits: number; n: number }>
): VolatilityBreakdown {
  // Within-cell: stddev of a Bernoulli sample per cell (needs >=2 runs).
  const perCell: number[] = [];
  for (const cell of cellMentions.values()) {
    if (cell.n < 2) continue;
    const p = cell.hits / cell.n;
    perCell.push(Math.sqrt(p * (1 - p)));
  }
  const repeatedRun = perCell.length
    ? Number((perCell.reduce((a, b) => a + b, 0) / perCell.length).toFixed(4))
    : null;

  return {
    repeatedRun,
    prompt: groupRateDispersion(observations, (o) => o.promptText),
    engine: groupRateDispersion(observations, (o) => o.engine),
    geo: groupRateDispersion(observations, (o) => o.geo),
    persona: groupRateDispersion(observations, (o) => o.persona ?? "__none__"),
  };
}

function aggregateByEngine(
  observations: Observation[]
): Record<string, { n: number; mention_rate: number; sufficient: boolean }> {
  const out: Record<string, { n: number; mention_rate: number; sufficient: boolean }> = {};
  const byEngine = new Map<string, { hits: number; n: number }>();
  for (const o of observations) {
    const acc = byEngine.get(o.engine) || { hits: 0, n: 0 };
    acc.hits += o.brandMentioned ? 1 : 0;
    acc.n += 1;
    byEngine.set(o.engine, acc);
  }
  for (const [engine, acc] of byEngine) {
    out[engine] = {
      n: acc.n,
      mention_rate: acc.n ? Number((acc.hits / acc.n).toFixed(4)) : 0,
      // Engine-level trends need their own credible sample (Phase 0 policy).
      sufficient: acc.n >= MIN_ENGINE_SAMPLE,
    };
  }
  return out;
}
