import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { generateStructured } from "@/lib/providers/ai-gateway";
import type { GscDecayRow } from "@/lib/engines/gsc-queries";

/**
 * Phase 19: SERP feature capture & content decay.
 *
 *  - Detect featured-snippet / PAA opportunities on tracked keywords where the
 *    SERP shows the feature but the brand doesn't own position 1, then generate
 *    a snippet-optimized block (definition / list / table) to win it.
 *  - Turn GSC content-decay rows into tracked refresh tasks.
 */

export type SnippetFormat = "paragraph" | "list" | "table";

export interface SnippetOpportunity {
  keyword: string;
  feature: string; // featured_snippet | people_also_ask | ...
  currentPosition: number | null;
  recommendedFormat: SnippetFormat;
}

const SNIPPET_FEATURES = new Set([
  "featured_snippet",
  "answer_box",
  "people_also_ask",
  "paa",
]);

function normalizeFeatures(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((f) => String(f).toLowerCase());
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((f) => String(f).toLowerCase());
    } catch {
      return [raw.toLowerCase()];
    }
  }
  return [];
}

function recommendFormat(keyword: string): SnippetFormat {
  const k = keyword.toLowerCase();
  if (/\b(best|top|ways|tips|steps|list|examples?)\b/.test(k)) return "list";
  if (/\b(vs|versus|compare|comparison|pricing|cost|price)\b/.test(k)) return "table";
  return "paragraph";
}

/**
 * From tracked rank rows, find keywords that surface a snippet/PAA feature where
 * the brand isn't already in position 1 — those are winnable.
 */
export function detectSnippetOpportunities(
  rows: Array<{ keyword: string; last_position: number | null; last_serp_features: unknown }>
): SnippetOpportunity[] {
  const opps: SnippetOpportunity[] = [];
  for (const r of rows) {
    const features = normalizeFeatures(r.last_serp_features);
    const snippetFeature = features.find((f) => SNIPPET_FEATURES.has(f));
    if (!snippetFeature) continue;
    if (r.last_position === 1) continue; // already likely owns the box
    opps.push({
      keyword: r.keyword,
      feature: snippetFeature,
      currentPosition: r.last_position,
      recommendedFormat: recommendFormat(r.keyword),
    });
  }
  return opps.sort((a, b) => (a.currentPosition ?? 99) - (b.currentPosition ?? 99));
}

const SnippetBlockSchema = z.object({
  format: z.enum(["paragraph", "list", "table"]),
  question_heading: z.string(),
  snippet_html: z.string().describe("Ready-to-paste HTML for the snippet block"),
  plain_answer: z.string().describe("40-60 word direct answer"),
});

export type SnippetBlock = z.infer<typeof SnippetBlockSchema>;

/**
 * Generate a snippet-optimized block formatted to win the targeted SERP feature.
 */
export async function generateSnippetBlock(input: {
  keyword: string;
  format: SnippetFormat;
  brand: string;
}): Promise<{ available: boolean; reason?: string; block?: SnippetBlock }> {
  const res = await generateStructured(
    "You optimize content to win Google featured snippets and People-Also-Ask boxes. Lead with a concise, direct answer, then the structured format (paragraph/list/table) Google extracts. No fluff.",
    `Keyword: ${input.keyword}\nPreferred format: ${input.format}\nBrand: ${input.brand}\n\nWrite a snippet-winning block: a question-style H2 + a 40-60 word direct answer + the ${input.format} content as clean HTML.`,
    SnippetBlockSchema
  );
  if (!res.success || !res.data) return { available: false, reason: res.error || "AI unavailable" };
  return { available: true, block: res.data };
}

/**
 * Convert GSC content-decay rows into tracked refresh tasks (dedup on URL).
 */
export async function createDecayRefreshTasks(
  supabase: SupabaseClient,
  projectId: string,
  organizationId: string,
  decay: GscDecayRow[]
): Promise<{ created: number }> {
  if (!decay.length) return { created: 0 };

  const rows = decay.slice(0, 50).map((d) => {
    const lossPct = d.prevImpressions ? Math.round((-d.impressionDelta / d.prevImpressions) * 100) : 0;
    return {
      project_id: projectId,
      organization_id: organizationId,
      title: `Refresh decaying page: ${d.url}`,
      description: `Impressions down ${lossPct}% (${d.prevImpressions} -> ${d.currImpressions}), clicks ${d.prevClicks} -> ${d.currClicks}. Refresh content, update stats, re-target lost queries.`,
      source_module: "content_gap",
      source_id: `decay:${d.url}`,
      category: "content",
      priority: lossPct >= 50 ? "high" : "medium",
      impact: Math.min(90, 40 + lossPct),
      effort: 30,
      status: "todo",
      evidence: { decay: d },
    };
  });

  await supabase.from("execution_tasks").upsert(rows, { onConflict: "project_id,source_module,source_id" });
  return { created: rows.length };
}
