/**
 * SearchOps AI visibility miner — pure functions over already-loaded probes.
 * Never calls LLMs or paid providers.
 */
import type { SearchOpsOpportunity } from "@/lib/engines/searchops-opportunity-engine";
import type { VisibilityResult } from "@/types/database";
import {
  competitorWinPrompts,
  missingCitationSources,
  pageOpportunities,
} from "@/lib/engines/visibility-insights";

const MIN_CLUSTER_N = 5;
const MIN_MEASURED_HEADLINE = 10;

function classifyIntent(prompt: string): string {
  const p = prompt.toLowerCase();
  if (/\b(buy|price|pricing|cost|hire|near me|best)\b/.test(p)) return "commercial";
  if (/\b(how to|what is|why|guide|vs|versus)\b/.test(p)) return "informational";
  if (/\b(login|official|website|contact)\b/.test(p)) return "navigational";
  return "informational";
}

function measuredOnly(results: VisibilityResult[]): VisibilityResult[] {
  return results.filter((r) => (r.data_source || "").toLowerCase() === "measured");
}

/**
 * Group measured probes by intent; flag weak clusters where brand mention rate is low.
 * Below sample gate → returns [] (caller may surface aggregate unavailable elsewhere).
 */
export function minePromptClusterOpportunities(
  projectId: string,
  results: VisibilityResult[],
  opts: { ratesReliable?: boolean; max?: number } = {}
): SearchOpsOpportunity[] {
  const max = opts.max ?? 6;
  const measured = measuredOnly(results);
  if (measured.length < MIN_CLUSTER_N) return [];

  type Bucket = { n: number; mentioned: number; prompts: string[] };
  const byIntent = new Map<string, Bucket>();
  for (const r of measured) {
    const intent = classifyIntent(r.prompt_text || "");
    const b = byIntent.get(intent) || { n: 0, mentioned: 0, prompts: [] };
    b.n += 1;
    if (r.brand_mentioned) b.mentioned += 1;
    if (r.prompt_text && b.prompts.length < 5) b.prompts.push(r.prompt_text);
    byIntent.set(intent, b);
  }

  const out: SearchOpsOpportunity[] = [];
  for (const [intent, b] of [...byIntent.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (b.n < MIN_CLUSTER_N) continue;
    const rate = b.mentioned / b.n;
    if (rate >= 0.25) continue;
    const confidence = b.n >= MIN_MEASURED_HEADLINE ? 0.85 : 0.55;
    out.push({
      id: `${projectId}:ai_cluster:${intent}`,
      projectId,
      category: "ai_visibility",
      title: `Weak AI visibility cluster: ${intent} (${Math.round(rate * 100)}% mention across ${b.n} probes)`,
      diagnosis: `Measured probes in the “${intent}” intent cluster mention the brand in ${b.mentioned}/${b.n} answers. Competing prompts in this cluster need answer-first coverage.`,
      evidence: [
        {
          label: "Cluster mention rate",
          source: "visibility_results",
          status: "measured",
          confidence,
          value: {
            intent,
            sampleSize: b.n,
            mentioned: b.mentioned,
            mentionRate: rate,
            samplePrompts: b.prompts,
            ratesReliable: opts.ratesReliable ?? false,
          },
        },
      ],
      priority: rate < 0.1 && b.n >= MIN_MEASURED_HEADLINE ? "high" : "medium",
      impactType: "measured",
      effort: "high",
      recommendedAction: `Build answer-first assets for ${intent} prompts currently losing AI mentions (start with: ${b.prompts.slice(0, 2).map((p) => `“${p.slice(0, 60)}”`).join(", ") || "top cluster prompts"}).`,
      verificationPlan:
        "Re-run the same grounded visibility scan for these prompts; cluster mention rate must rise with measured probes (n≥5).",
      limitations: [
        "Cluster rates are not a guarantee of future AI citations.",
        ...(b.n < MIN_MEASURED_HEADLINE
          ? [`Cluster sample n=${b.n} is below the headline reliability gate (≥${MIN_MEASURED_HEADLINE}).`]
          : []),
      ],
    });
  }
  return out.slice(0, max);
}

/**
 * Prompts where competitors win and brand is absent — answer coverage gaps.
 */
export function mineAnswerGapOpportunities(
  projectId: string,
  results: VisibilityResult[],
  opts: { max?: number } = {}
): SearchOpsOpportunity[] {
  const max = opts.max ?? 8;
  const plays = pageOpportunities(results, max);
  const out: SearchOpsOpportunity[] = [];

  for (const play of plays.create) {
    out.push({
      id: `${projectId}:ai_answer_gap:${play.prompt.slice(0, 80)}`,
      projectId,
      category: "ai_visibility",
      title: `Answer gap: brand absent while competitors win “${play.prompt.slice(0, 72)}${play.prompt.length > 72 ? "…" : ""}”`,
      diagnosis: `${play.reason} Engines: ${play.engines.join(", ")}. Competitors seen: ${play.competitors.join(", ") || "n/a"}.`,
      evidence: [
        {
          label: "Competitor-won prompt (brand absent)",
          source: "visibility_results",
          status: "measured",
          confidence: play.engines.length >= 2 ? 0.85 : 0.65,
          value: {
            prompt: play.prompt,
            engines: play.engines,
            competitors: play.competitors,
          },
        },
      ],
      priority: play.competitors.length >= 2 ? "high" : "medium",
      impactType: "measured",
      effort: "high",
      recommendedAction: `Publish an answer-first page targeting “${play.prompt.slice(0, 100)}” with verifiable facts and clear entity naming; re-probe the same engines.`,
      verificationPlan:
        "Re-run visibility probes for this exact prompt on the same engines; brand_mentioned or brand_cited must flip to true on a measured result.",
      limitations: ["Winning a probe once is not durable AI visibility.", "No guaranteed LLM citation claim."],
    });
  }

  for (const play of plays.update.slice(0, Math.max(0, max - out.length))) {
    out.push({
      id: `${projectId}:ai_mention_not_cited:${play.prompt.slice(0, 80)}`,
      projectId,
      category: "ai_visibility",
      title: `Mentioned but not cited: “${play.prompt.slice(0, 72)}${play.prompt.length > 72 ? "…" : ""}”`,
      diagnosis: play.reason,
      evidence: [
        {
          label: "Mention without citation",
          source: "visibility_results",
          status: "measured",
          confidence: 0.75,
          value: { prompt: play.prompt, engines: play.engines },
        },
      ],
      priority: "medium",
      impactType: "measured",
      effort: "medium",
      recommendedAction: `Strengthen the ranking/answer page for “${play.prompt.slice(0, 100)}” with citable facts, primary sources, and relevant schema — then re-probe.`,
      verificationPlan:
        "Re-run probes for this prompt; brand_cited must become true on a measured result for at least one engine.",
      limitations: ["Citation conversion is not guaranteed from mention alone."],
    });
  }

  return out.slice(0, max);
}

/**
 * Third-party domains cited when competitors win and brand is not cited.
 */
export function mineMissingCitationOpportunities(
  projectId: string,
  results: VisibilityResult[],
  brandDomain: string,
  opts: { max?: number } = {}
): SearchOpsOpportunity[] {
  const max = opts.max ?? 8;
  if (!brandDomain?.trim()) return [];
  const gaps = missingCitationSources(results, brandDomain, max);
  if (!gaps.length) {
    // Distinguish "no source graph evidence" vs empty: if zero measured probes with sources, stay silent
    // (aggregate AI unavailable card already covers no-probe cases).
    return [];
  }

  return gaps.map((g) => ({
    id: `${projectId}:ai_missing_citation:${g.domain}`,
    projectId,
    category: "ai_visibility" as const,
    title: `Competitor-cited source: ${g.domain} (${g.count} measured answers)`,
    diagnosis: `Measured AI answers cite ${g.domain} while the brand is not cited and competitors appear (${g.competitors.join(", ") || "competitors present"}).`,
    evidence: [
      {
        label: "Third-party citation without brand",
        source: "visibility_results",
        status: "measured" as const,
        confidence: g.count >= 3 ? 0.85 : 0.65,
        value: {
          domain: g.domain,
          answerCount: g.count,
          competitors: g.competitors,
        },
      },
    ],
    priority: g.count >= 3 ? ("high" as const) : ("medium" as const),
    impactType: "measured" as const,
    effort: "high" as const,
    recommendedAction: `Earn a credible mention or resource on ${g.domain} with original data or expert commentary — do not spam links; target the prompts where competitors already win.`,
    verificationPlan:
      "Re-run grounded visibility probes for the affected prompts; brand_cited or source_domains must include a brand-owned or brand-confirming URL path after coverage.",
    limitations: [
      "Appearing on a cited source does not guarantee LLM citation.",
      "Outreach language must stay factual — no guaranteed ranking/AI claims.",
    ],
  }));
}

/**
 * Competitor-win prompts as a focused opportunity set (complements answer gaps).
 */
export function mineCompetitorWinOpportunities(
  projectId: string,
  results: VisibilityResult[],
  opts: { max?: number } = {}
): SearchOpsOpportunity[] {
  const max = opts.max ?? 6;
  const wins = competitorWinPrompts(results, max);
  return wins.map((w) => ({
    id: `${projectId}:ai_competitor_win:${w.engine}:${w.prompt.slice(0, 60)}`,
    projectId,
    category: "ai_visibility" as const,
    title: `Competitor wins on ${w.engine}: “${w.prompt.slice(0, 64)}${w.prompt.length > 64 ? "…" : ""}”`,
    diagnosis: `Measured probe on ${w.engine} shows brand absent while competitors appear: ${w.competitors.join(", ")}.`,
    evidence: [
      {
        label: "Competitor win / brand absent",
        source: "visibility_results",
        status: "measured" as const,
        confidence: 0.8,
        value: { prompt: w.prompt, engine: w.engine, competitors: w.competitors },
      },
    ],
    priority: w.competitors.length >= 2 ? ("high" as const) : ("medium" as const),
    impactType: "measured" as const,
    effort: "medium" as const,
    recommendedAction: `Create or strengthen an evidence-backed answer for “${w.prompt.slice(0, 100)}” that names the brand entity clearly for ${w.engine}.`,
    verificationPlan: `Re-run the same prompt on ${w.engine}; brand_mentioned must be true on a measured result.`,
    limitations: ["Single-engine wins can vary; prefer multi-engine confirmation."],
  }));
}

/**
 * Aggregate AI visibility deep mining. Returns [] when sample gate fails (not fake zero).
 */
export function mineAiVisibilityOpportunities(
  projectId: string,
  results: VisibilityResult[],
  brandDomain: string,
  opts: { ratesReliable?: boolean; maxTotal?: number } = {}
): SearchOpsOpportunity[] {
  const measured = measuredOnly(results);
  if (measured.length === 0) return [];

  const clusters = minePromptClusterOpportunities(projectId, measured, {
    ratesReliable: opts.ratesReliable,
    max: 4,
  });
  const answers = mineAnswerGapOpportunities(projectId, measured, { max: 6 });
  const citations = mineMissingCitationOpportunities(projectId, measured, brandDomain, {
    max: 6,
  });
  // Avoid flooding: competitor-win overlaps heavily with answer gaps — take top few only.
  const wins = mineCompetitorWinOpportunities(projectId, measured, { max: 3 });

  const merged = [...clusters, ...answers, ...citations, ...wins];
  const byId = new Map<string, SearchOpsOpportunity>();
  for (const op of merged) {
    if (!byId.has(op.id)) byId.set(op.id, op);
  }
  return [...byId.values()]
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, opts.maxTotal ?? 20);
}
