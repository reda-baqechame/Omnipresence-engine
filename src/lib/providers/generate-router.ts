/**
 * Sovereign generation router (Phase 23 / manifest v24, Wave J).
 *
 * Content generation/rewrite is routed self-hosted-first: Ollama (free, open
 * models) is tried before any paid LLM. Each candidate output passes through
 * quality gates (editorial QA + structural-AEO). If the sovereign model's
 * output fails the gates, we transparently upgrade to the next adapter (a paid
 * LLM, when configured) — so paid keys are an optional quality lever, never a
 * hard dependency. In Zero-Paid-Keys mode the router simply never offers the
 * paid adapters.
 */
import type { ProviderResult } from "./types";
import { rankedAdapters, attachRunner } from "./router";
import { generateWithOllama } from "./ollama";
import { assertWithinBudget, recordSpend, maxOutputTokens } from "./cost-guard";
import { computeReadability } from "@/lib/engines/editorial-qa";
import { findForbiddenClaims } from "@/lib/config/claims";
import { detectContentDefects } from "@/lib/engines/content-defects";

// ---------------------------------------------------------------------------
// Quality gates
// ---------------------------------------------------------------------------

export interface QualityGateOptions {
  /** Minimum word count (0 = skip thin-content gate, e.g. titles/meta). */
  minWords?: number;
  /** Require answer-engine-friendly structure (headings/lists/lead/Q&A). */
  requireStructure?: boolean;
  /** Minimum structural-AEO score 0..100 when requireStructure is true. */
  minStructureScore?: number;
  /** Reject "very confusing" prose below this Flesch reading ease. */
  minReadingEase?: number;
}

export interface StructuralAeo {
  score: number;
  hasHeadings: boolean;
  hasList: boolean;
  hasShortLead: boolean;
  hasQuestion: boolean;
}

/** Pure structural-AEO heuristic — does the text answer like AI engines prefer? */
export function scoreStructuralAeo(text: string): StructuralAeo {
  const hasHeadings = /(^|\n)#{1,6}\s/.test(text) || /<h[1-6][\s>]/i.test(text);
  const hasList = /(^|\n)\s*[-*]\s+/.test(text) || /(^|\n)\s*\d+\.\s+/.test(text) || /<(ul|ol|li)[\s>]/i.test(text);
  const firstSentence = (text.trim().split(/(?<=[.!?])\s/)[0] || "").split(/\s+/).filter(Boolean).length;
  const hasShortLead = firstSentence > 0 && firstSentence <= 30;
  const hasQuestion = /\?/.test(text);
  const score =
    (hasHeadings ? 25 : 0) + (hasList ? 25 : 0) + (hasShortLead ? 25 : 0) + (hasQuestion ? 25 : 0);
  return { score, hasHeadings, hasList, hasShortLead, hasQuestion };
}

export interface QualityResult {
  passed: boolean;
  words: number;
  readingEase: number;
  structureScore: number;
  reasons: string[];
  /** True when the text contains an outcome promise we refuse to make. */
  forbidden: boolean;
  /** True when the text contains unprofessional LLM artifacts (placeholders, AI self-refs). */
  unprofessional: boolean;
}

export function evaluateQuality(text: string, opts: QualityGateOptions = {}): QualityResult {
  const reasons: string[] = [];
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;

  if (words === 0) reasons.push("empty output");
  const minWords = opts.minWords ?? 0;
  if (minWords > 0 && words < minWords) reasons.push(`too short: ${words}/${minWords} words`);

  const readability = computeReadability(trimmed || " ");
  const minEase = opts.minReadingEase ?? -Infinity;
  if (Number.isFinite(minEase) && readability.fleschReadingEase < minEase) {
    reasons.push(`hard to read (Flesch ${readability.fleschReadingEase} < ${minEase})`);
  }

  const structure = scoreStructuralAeo(trimmed);
  if (opts.requireStructure && structure.score < (opts.minStructureScore ?? 50)) {
    reasons.push(`weak structure (AEO ${structure.score} < ${opts.minStructureScore ?? 50})`);
  }

  // Hard honesty gate: never let generated copy ship an outcome promise we
  // refuse to make (rank #1, guaranteed traffic, "appear everywhere in AI").
  const forbidden = findForbiddenClaims(trimmed);
  if (forbidden.length > 0) {
    reasons.push(`forbidden outcome promise: ${forbidden.join(", ")}`);
  }

  // Hard professionalism gate: never ship LLM artifacts (AI self-references,
  // refusals, unfilled placeholders, template tokens) to a client.
  const defects = detectContentDefects(trimmed);
  if (defects.length > 0) {
    reasons.push(`unprofessional output: ${defects.join(", ")}`);
  }

  return {
    passed: reasons.length === 0,
    forbidden: forbidden.length > 0,
    unprofessional: defects.length > 0,
    words,
    readingEase: readability.fleschReadingEase,
    structureScore: structure.score,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Adapter runners (wired into the unified router's `generate` port)
// ---------------------------------------------------------------------------

async function runOllama(system: string, user: string): Promise<ProviderResult<string>> {
  const out = await generateWithOllama(system, user);
  if (!out.available) return { success: false, error: out.reason || "Ollama unavailable" };
  return { success: true, data: out.text, creditsUsed: 0 };
}

async function runOpenAI(system: string, user: string): Promise<ProviderResult<string>> {
  try {
    await assertWithinBudget("openai");
    const { generateText } = await import("ai");
    const { openai } = await import("@ai-sdk/openai");
    const modelId = "gpt-4o-mini";
    const result = await generateText({
      model: openai(modelId),
      system,
      prompt: user,
      maxOutputTokens: maxOutputTokens("content"),
      abortSignal: AbortSignal.timeout(60000),
    });
    await recordSpend("openai", modelId, result.usage, { fallbackOutputTokens: maxOutputTokens("content") });
    return { success: true, data: result.text, creditsUsed: 1 };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "OpenAI generation failed" };
  }
}

async function runAnthropic(system: string, user: string): Promise<ProviderResult<string>> {
  try {
    await assertWithinBudget("anthropic");
    const { generateText } = await import("ai");
    const { anthropic } = await import("@ai-sdk/anthropic");
    const { defaultModelId } = await import("@/lib/providers/ai-gateway");
    const modelId = defaultModelId("anthropic");
    const result = await generateText({
      model: anthropic(modelId),
      system,
      prompt: user,
      maxOutputTokens: maxOutputTokens("content"),
      abortSignal: AbortSignal.timeout(60000),
    });
    await recordSpend("anthropic", modelId, result.usage, { fallbackOutputTokens: maxOutputTokens("content") });
    return { success: true, data: result.text, creditsUsed: 1 };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Anthropic generation failed" };
  }
}

const RUNNERS: Record<string, (system: string, user: string) => Promise<ProviderResult<string>>> = {
  "ollama-generate": runOllama,
  "openai-generate": runOpenAI,
  "anthropic-generate": runAnthropic,
};

let wired = false;
function ensureWired(): void {
  if (wired) return;
  for (const [id, run] of Object.entries(RUNNERS)) {
    attachRunner("generate", id, run);
  }
  wired = true;
}

export interface GenerateOutcome extends ProviderResult<string> {
  provider?: string;
  quality?: QualityResult;
  /** Adapters tried, in order, and why each was accepted/rejected. */
  trail?: Array<{ id: string; ok: boolean; reason?: string }>;
  /** True when output was returned despite failing gates (best-effort fallback). */
  degraded?: boolean;
}

/**
 * Generate content sovereign-first with quality gates. Returns the first output
 * that passes the gates; if none pass, returns the best available output flagged
 * `degraded` (honest: callers can surface a low-confidence note rather than a
 * fake high-quality claim).
 */
export async function generateContent(
  systemPrompt: string,
  userPrompt: string,
  opts: QualityGateOptions = {}
): Promise<GenerateOutcome> {
  ensureWired();
  const ranked = rankedAdapters("generate").filter((a) => RUNNERS[a.id]);
  // Quality-first by default: when paid frontier LLM keys are present, try them
  // BEFORE the sovereign open model so customer-facing copy gets the best model.
  // ZERO_PAID_KEYS forces sovereign-only; GENERATION_SOVEREIGN_FIRST=true is the
  // opt-in cost-saver that prefers free Ollama and upgrades only on gate failure.
  const sovereignFirst =
    process.env.ZERO_PAID_KEYS === "true" || process.env.GENERATION_SOVEREIGN_FIRST === "true";
  const adapters = sovereignFirst
    ? ranked
    : [...ranked].sort((a, b) => (a.paid === b.paid ? 0 : a.paid ? -1 : 1));
  const trail: Array<{ id: string; ok: boolean; reason?: string }> = [];

  let best: GenerateOutcome | null = null;
  let lastError = "No generation provider configured";

  for (const adapter of adapters) {
    const result = await RUNNERS[adapter.id](systemPrompt, userPrompt);
    if (!result.success || !result.data) {
      lastError = result.error || lastError;
      trail.push({ id: adapter.id, ok: false, reason: lastError });
      continue;
    }
    const quality = evaluateQuality(result.data, opts);
    if (quality.passed) {
      trail.push({ id: adapter.id, ok: true });
      return { success: true, data: result.data, provider: adapter.id, quality, trail, creditsUsed: result.creditsUsed };
    }
    trail.push({ id: adapter.id, ok: false, reason: quality.reasons.join("; ") });
    // Hard fails: a forbidden outcome promise OR unprofessional LLM artifacts are
    // never kept, even as a degraded fallback — we would rather return nothing and
    // let the caller surface "unavailable" than ship a claim or amateur output.
    if (quality.forbidden || quality.unprofessional) {
      lastError = `output rejected: ${quality.reasons.join("; ")}`;
      continue;
    }
    // Keep the best degraded candidate (by structure score) in case nothing passes.
    if (!best || quality.structureScore > (best.quality?.structureScore ?? -1)) {
      best = { success: true, data: result.data, provider: adapter.id, quality, degraded: true, trail, creditsUsed: result.creditsUsed };
    }
  }

  if (best) return { ...best, trail };
  return { success: false, error: lastError, trail };
}
