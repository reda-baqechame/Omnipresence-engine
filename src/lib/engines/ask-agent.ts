import type { SupabaseClient } from "@supabase/supabase-js";
import { generateWithAI } from "@/lib/providers/ai-gateway";

/**
 * "Ask" agent (Master Plan v4 feature 9, Athena pattern): answers questions
 * over the project's OWN measured data — latest visibility metrics, share of
 * voice, sprints, gaps, receipts. It is grounded exclusively in the context
 * assembled here; the system prompt forbids outside knowledge so it cannot
 * invent numbers the product never measured.
 */

export interface AskAnswer {
  answer: string;
  contextSummary: {
    measuredResults: number;
    receipts: number;
    sprints: number;
  };
}

async function buildProjectContext(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ text: string; measuredResults: number; receipts: number; sprints: number }> {
  const [resultsQ, receiptsQ, sprintsQ, claimsQ] = await Promise.all([
    supabase
      .from("visibility_results")
      .select("engine, prompt_text, brand_mentioned, brand_cited, data_source, source_domains, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("ai_capture_evidence")
      .select("id, engine, surface, prompt, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("action_sprints")
      .select("week_start, status, outcome_verdict, baseline, outcome, items")
      .eq("project_id", projectId)
      .order("week_start", { ascending: false })
      .limit(8),
    supabase
      .from("claim_reviews")
      .select("created_at, flagged_count, answers_reviewed")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const results = resultsQ.data || [];
  const measured = results.filter((r) => r.data_source === "measured");

  // Per-engine mention/citation rates over measured rows only.
  const byEngine = new Map<string, { total: number; mentioned: number; cited: number }>();
  for (const r of measured) {
    const e = byEngine.get(r.engine) || { total: 0, mentioned: 0, cited: 0 };
    e.total += 1;
    if (r.brand_mentioned) e.mentioned += 1;
    if (r.brand_cited) e.cited += 1;
    byEngine.set(r.engine, e);
  }
  const engineLines = [...byEngine.entries()].map(
    ([engine, s]) =>
      `- ${engine}: ${s.total} measured answers, brand mentioned in ${s.mentioned} (${Math.round((s.mentioned / s.total) * 100)}%), cited in ${s.cited}`
  );

  // Which domains get cited across measured answers (the "instead of you" list).
  const domainCounts = new Map<string, number>();
  for (const r of measured) {
    for (const d of r.source_domains || []) {
      domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
    }
  }
  const topDomains = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([d, n]) => `${d} (${n})`);

  const sprints = sprintsQ.data || [];
  const sprintLines = sprints.map((s) => {
    const b = s.baseline as { mention_rate?: number; sample_size?: number } | null;
    const o = s.outcome as { mention_rate?: number; sample_size?: number } | null;
    return `- week ${s.week_start}: ${s.status}${s.outcome_verdict ? `, verdict ${s.outcome_verdict}` : ""}${
      b && o
        ? ` (mention rate ${Math.round((b.mention_rate || 0) * 100)}% -> ${Math.round((o.mention_rate || 0) * 100)}%)`
        : ""
    }`;
  });

  const receipts = receiptsQ.data || [];
  const claim = claimsQ.data?.[0];

  const text = [
    `MEASURED VISIBILITY (last ${results.length} probe results, ${measured.length} with measured provenance):`,
    engineLines.length ? engineLines.join("\n") : "- no measured engine data yet",
    ``,
    `TOP CITED DOMAINS across measured answers: ${topDomains.length ? topDomains.join(", ") : "none captured yet"}`,
    ``,
    `ACTION SPRINTS (${sprints.length}):`,
    sprintLines.length ? sprintLines.join("\n") : "- none yet",
    ``,
    `RECEIPTS: ${receipts.length} recent evidence records (each verifiable at /verify/{id}). Latest engines: ${[...new Set(receipts.map((r) => r.engine))].join(", ") || "none"}`,
    claim
      ? `CLAIM REVIEW: last run ${claim.created_at}, ${claim.flagged_count} flagged out of ${claim.answers_reviewed} answers reviewed`
      : `CLAIM REVIEW: never run`,
  ].join("\n");

  return { text, measuredResults: measured.length, receipts: receipts.length, sprints: sprints.length };
}

export async function askProjectAgent(
  supabase: SupabaseClient,
  project: { id: string; brand_name: string; domain: string },
  question: string
): Promise<AskAnswer | { error: string }> {
  const ctx = await buildProjectContext(supabase, project.id);

  const res = await generateWithAI(
    `You are the PresenceOS "Ask" agent for the brand "${project.brand_name}" (${project.domain}). Answer questions using ONLY the measured project data below. Rules:
- Never invent numbers, engines, competitors, or trends that are not in the data.
- If the data can't answer the question, say exactly what measurement is missing and which action (scan, sprint, claim review) would produce it.
- Cite the data you used ("across your N measured ChatGPT answers...").
- Be direct and useful — 2 short paragraphs max, no filler.

PROJECT DATA:
${ctx.text}`,
    question,
    "quality"
  );

  if (!res.success || !res.data) {
    return { error: res.error || "The agent could not generate an answer — no LLM provider available." };
  }

  return {
    answer: res.data,
    contextSummary: {
      measuredResults: ctx.measuredResults,
      receipts: ctx.receipts,
      sprints: ctx.sprints,
    },
  };
}
