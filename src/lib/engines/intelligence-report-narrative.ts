/**
 * Optional LLM narrative for Deep Intelligence Reports.
 * Cost-guarded; deterministic bullet fallback when budget exhausted.
 */
import type { IntelligenceReport } from "@/types/intelligence-report";
import { assertWithinBudget, recordSpend, BudgetExceededError } from "@/lib/providers/cost-guard";

export type ReportNarrative = Partial<Record<string, string>>;

const NARRATIVE_MODEL = process.env.AI_GEMINI_MODEL || "gemini-flash-latest";

function deterministicNarrative(report: IntelligenceReport): ReportNarrative {
  const exec = report.executive;
  const vis = report.visibility.snapshot;
  return {
    executive: `OmniPresence score of ${exec.omnipresenceScore}/100 (${exec.scoreLabel}). ${exec.keyFindings.slice(0, 3).join(". ")}.`,
    competitive: report.competitive.available
      ? `Your domain ranks popularity tier ${report.competitive.target?.popularity.tier}/10 with authority rating ${report.competitive.target?.authority.rating}. Compare against ${report.competitive.competitors.length} tracked competitors in the matrix above.`
      : undefined,
    visibility: report.visibility.available && vis.ratesReliable
      ? `Across ${vis.groundedCount} grounded probes, mention rate is ${Math.round(vis.metrics.mentionRate * 100)}% and citation rate ${Math.round(vis.metrics.citationRate * 100)}%. ${report.visibility.competitorWinCount} prompts show competitor wins requiring content intervention.`
      : report.visibility.snapshot.reliabilityNote || undefined,
    keywords: report.keywords.available
      ? `${report.keywords.opportunities.length} keyword opportunities identified with ${report.keywords.strikingDistance.length} in striking distance (positions 4–20) for fastest traffic upside.`
      : undefined,
  };
}

async function callGemini(prompt: string): Promise<string | null> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    await assertWithinBudget("gemini");
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${NARRATIVE_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 512, temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      await recordSpend("gemini", NARRATIVE_MODEL, { inputTokens: 400, outputTokens: Math.ceil(text.length / 4) });
    }
    return text || null;
  } catch (err) {
    if (err instanceof BudgetExceededError) return null;
    return null;
  }
}

export async function generateReportNarrative(
  report: IntelligenceReport,
  opts: { useLlm?: boolean } = {}
): Promise<ReportNarrative> {
  const fallback = deterministicNarrative(report);

  if (opts.useLlm === false || process.env.REPORT_NARRATIVE_LLM === "false") {
    return fallback;
  }

  const summaryPrompt = `You are a senior digital strategy consultant writing an executive summary for a client report.
Brand: ${report.meta.brandName} (${report.meta.domain})
OmniPresence Score: ${report.executive.omnipresenceScore}/100
Key findings: ${report.executive.keyFindings.join("; ")}
AI mention rate: ${report.visibility.snapshot.ratesReliable ? Math.round(report.visibility.snapshot.metrics.mentionRate * 100) + "%" : "insufficient data"}
Critical technical issues: ${report.technical.criticalCount}

Write 3-4 sentences of professional, actionable executive summary prose. No bullet points. Be specific and confident but honest about data limitations.`;

  const execNarrative = await callGemini(summaryPrompt);
  if (!execNarrative) return fallback;

  return { ...fallback, executive: execNarrative };
}
