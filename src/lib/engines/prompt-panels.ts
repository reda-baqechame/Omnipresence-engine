/**
 * Prompt panels (Wave O) — curated measurement units.
 *
 * A panel is a cluster of prompts measured as a matrix
 * (engines × geos × personas × runs_per_prompt). This module holds the shared
 * types + pure helpers (matrix expansion, sanitisation, cost estimation) used by
 * the CRUD API, the panel runner, and the UI. Pure + dependency-free so it is
 * trivially testable and safe on any code path.
 */
import type { VisibilityEngine } from "@/types/database";
import { SCAN_ENGINES } from "@/lib/config/scan-engines";

export interface PromptPanel {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  geos: string[];
  personas: string[];
  engines: string[];
  runs_per_prompt: number;
  is_active: boolean;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromptPanelMember {
  id: string;
  panel_id: string;
  project_id: string;
  prompt_id: string | null;
  prompt_text: string;
  weight: number;
}

/** One concrete probe cell in the panel matrix. */
export interface PanelCell {
  promptText: string;
  promptId?: string | null;
  engine: VisibilityEngine;
  geo: string | null;
  persona: string | null;
  runs: number;
}

const MAX_RUNS = 10;
const DEFAULT_GEO = "United States";

/** Clamp runs_per_prompt to a sane, budget-safe 1..10. */
export function clampRuns(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return 3;
  return Math.min(MAX_RUNS, Math.max(1, v));
}

/** Keep only engines we can actually probe; default to the canonical set. */
export function sanitizeEngines(engines: string[] | undefined): VisibilityEngine[] {
  const allowed = new Set<string>(SCAN_ENGINES as string[]);
  const picked = (engines || []).filter((e) => allowed.has(e)) as VisibilityEngine[];
  return picked.length ? picked : [...SCAN_ENGINES];
}

/**
 * Expand a panel + its members into the full list of probe cells. Empty
 * geos/personas collapse to a single default cell so a minimal panel still runs.
 */
export function expandPanelMatrix(
  panel: Pick<PromptPanel, "geos" | "personas" | "engines" | "runs_per_prompt">,
  members: Array<Pick<PromptPanelMember, "prompt_text" | "prompt_id">>
): PanelCell[] {
  const engines = sanitizeEngines(panel.engines);
  const geos = panel.geos.length ? panel.geos : [DEFAULT_GEO];
  const personas = panel.personas.length ? panel.personas : [null];
  const runs = clampRuns(panel.runs_per_prompt);

  const cells: PanelCell[] = [];
  for (const member of members) {
    if (!member.prompt_text?.trim()) continue;
    for (const engine of engines) {
      for (const geo of geos) {
        for (const persona of personas) {
          cells.push({
            promptText: member.prompt_text,
            promptId: member.prompt_id ?? null,
            engine,
            geo,
            persona: persona ?? null,
            runs,
          });
        }
      }
    }
  }
  return cells;
}

/** Number of provider calls a full panel run will make (cost preview). */
export function estimatePanelCalls(
  panel: Pick<PromptPanel, "geos" | "personas" | "engines" | "runs_per_prompt">,
  memberCount: number
): number {
  const engines = sanitizeEngines(panel.engines).length;
  const geos = panel.geos.length || 1;
  const personas = panel.personas.length || 1;
  return memberCount * engines * geos * personas * clampRuns(panel.runs_per_prompt);
}
