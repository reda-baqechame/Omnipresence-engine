/**
 * LLM / paid-API cost guard.
 *
 * Protects the platform owner's provider accounts (OpenAI, Anthropic, Gemini,
 * Perplexity, ...) from an unbounded bill. Three layers, all configurable:
 *
 *   1. Per-call output token caps (maxOutputTokens) — bounds a single call.
 *   2. Per-instance sliding-window rate limit — kills runaway loops fast,
 *      needs no DB.
 *   3. Durable daily + monthly USD budget (Supabase `api_spend_daily`) — caps
 *      sustained spend across all serverless instances/callers.
 *
 * Fail-safe by design: budget reads that error never crash the product (the
 * call proceeds, bounded by the token cap + rate limit). When a budget or rate
 * limit IS hit, callers get a clean BudgetExceededError → they degrade the
 * affected engine to "unavailable" (honest), never a crash or a fake zero.
 *
 * Disable entirely (not recommended) with LLM_BUDGET_DISABLED=true.
 */

import { logProviderError } from "@/lib/observability/log";

export type GuardProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "perplexity"
  | "other";

// USD per 1,000,000 tokens. Conservative public list prices; used only to
// ESTIMATE spend for the budget — not billed to anyone.
const PRICING: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "claude-3-5-haiku-latest": { in: 0.8, out: 4 },
  "claude-3-5-sonnet-latest": { in: 3, out: 15 },
  "gemini-2.0-flash": { in: 0.1, out: 0.4 },
  "gemini-1.5-flash": { in: 0.075, out: 0.3 },
  sonar: { in: 1, out: 1 },
  "sonar-pro": { in: 3, out: 15 },
};
// Used when a model isn't in the table — deliberately on the high side so the
// guard errs toward stopping early rather than overspending.
const DEFAULT_PRICE = { in: 1, out: 3 };

function num(envKey: string, dflt: number): number {
  const v = Number(process.env[envKey]);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
}

function guardDisabled(): boolean {
  return process.env.LLM_BUDGET_DISABLED === "true";
}

/**
 * Max output tokens for a call.
 *  - "probe":   short brand-visibility answers (cheap, frequent).
 *  - "content": long-form generation (blogs, prompt universes, rewrites).
 */
export function maxOutputTokens(kind: "probe" | "content" = "probe"): number {
  return kind === "content"
    ? Math.floor(num("LLM_MAX_CONTENT_TOKENS", 8192))
    : Math.floor(num("LLM_MAX_OUTPUT_TOKENS", 800));
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] || DEFAULT_PRICE;
  return (inputTokens / 1_000_000) * p.in + (outputTokens / 1_000_000) * p.out;
}

/** Token usage in any of the shapes providers report it. */
export interface CallUsage {
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

function normalizeUsage(u?: CallUsage): { inputTokens: number; outputTokens: number } {
  const inTok = Math.max(0, Math.round(u?.inputTokens ?? u?.promptTokens ?? 0));
  let outTok = Math.max(0, Math.round(u?.outputTokens ?? u?.completionTokens ?? 0));
  // Only a grand total was reported — attribute the remainder to output (conservative).
  if (outTok === 0 && u?.totalTokens) outTok = Math.max(0, Math.round(u.totalTokens - inTok));
  return { inputTokens: inTok, outputTokens: outTok };
}

export class BudgetExceededError extends Error {
  constructor(public reason: string) {
    super(`cost-guard: ${reason}`);
    this.name = "BudgetExceededError";
  }
}

// ---- Layer 2: per-instance sliding-window rate limiter ----
// Pure runaway-loop protection (the USD budget below is the real money cap).
// The counter is shared across concurrent requests on a warm serverless
// instance, so the default is set high enough that legitimate multi-tenant
// traffic never false-trips it, while a tight infinite loop (thousands/min) is
// still stopped instantly.
const callTimes: number[] = [];
function checkRate(): void {
  const limit = Math.floor(num("LLM_MAX_CALLS_PER_MIN", 300));
  if (limit <= 0) return;
  const now = Date.now();
  const windowStart = now - 60_000;
  while (callTimes.length && callTimes[0] < windowStart) callTimes.shift();
  if (callTimes.length >= limit) {
    throw new BudgetExceededError(`rate limit ${limit}/min exceeded`);
  }
  callTimes.push(now);
}

// ---- Layer 3: durable daily/monthly USD budget (cached to limit DB reads) ----
let cache: { day: string; dayCost: number; monthCost: number; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthStart(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

async function serviceClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function refreshCache(): Promise<void> {
  const day = todayKey();
  if (cache && cache.day === day && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return;
  try {
    const sb = await serviceClient();
    if (!sb) {
      cache = { day, dayCost: 0, monthCost: 0, fetchedAt: Date.now() };
      return;
    }
    const { data } = await sb
      .from("api_spend_daily")
      .select("day, est_cost_usd")
      .gte("day", monthStart());
    let dayCost = 0;
    let monthCost = 0;
    for (const r of data || []) {
      const c = Number(r.est_cost_usd) || 0;
      monthCost += c;
      if (r.day === day) dayCost += c;
    }
    cache = { day, dayCost, monthCost, fetchedAt: Date.now() };
  } catch (e) {
    // Fail-open on read errors: keep product working, bounded by token cap + rate.
    logProviderError("cost-guard.read", e, {});
    if (!cache || cache.day !== day) cache = { day, dayCost: 0, monthCost: 0, fetchedAt: Date.now() };
  }
}

/**
 * Throws BudgetExceededError if the call should be blocked. Call this BEFORE
 * every paid LLM request. Cheap after the first call (60s cache).
 */
export async function assertWithinBudget(_provider: GuardProvider): Promise<void> {
  if (guardDisabled()) return;
  checkRate();
  await refreshCache();
  if (cache) {
    const daily = num("LLM_DAILY_BUDGET_USD", 5);
    const monthly = num("LLM_MONTHLY_BUDGET_USD", 50);
    if (daily > 0 && cache.dayCost >= daily) {
      throw new BudgetExceededError(`daily budget $${daily} reached (spent ~$${cache.dayCost.toFixed(2)})`);
    }
    if (monthly > 0 && cache.monthCost >= monthly) {
      throw new BudgetExceededError(`monthly budget $${monthly} reached (spent ~$${cache.monthCost.toFixed(2)})`);
    }
  }
}

/**
 * Record the estimated cost of a completed call. Updates the in-process cache
 * immediately (so the next call in this invocation sees it) and persists
 * atomically. Best-effort: persistence errors are logged, never thrown.
 */
export async function recordSpend(
  provider: GuardProvider,
  model: string,
  usage?: CallUsage,
  opts?: { fallbackOutputTokens?: number }
): Promise<void> {
  if (guardDisabled()) return;
  let { inputTokens: inTok, outputTokens: outTok } = normalizeUsage(usage);
  if (inTok === 0 && outTok === 0) {
    // The provider returned no usage payload, but a paid call still happened —
    // never treat it as free, or the budget could be silently defeated. Charge a
    // conservative estimate (assume the output cap was used) so spend always
    // advances toward the limit.
    inTok = 500;
    outTok = opts?.fallbackOutputTokens ?? maxOutputTokens("probe");
  }
  const cost = estimateCostUsd(model, inTok, outTok);

  const day = todayKey();
  if (cache && cache.day === day) {
    cache.dayCost += cost;
    cache.monthCost += cost;
  }

  try {
    const sb = await serviceClient();
    if (!sb) return;
    await sb.rpc("increment_api_spend", {
      p_day: day,
      p_provider: provider,
      p_calls: 1,
      p_in: inTok,
      p_out: outTok,
      p_cost: cost,
    });
  } catch (e) {
    logProviderError("cost-guard.record", e, { provider, model });
  }
}

/** This-month spend grouped by provider (for the in-app usage view). */
export async function getSpendByProvider(): Promise<
  Array<{ provider: string; calls: number; costUsd: number }>
> {
  try {
    const sb = await serviceClient();
    if (!sb) return [];
    const { data } = await sb
      .from("api_spend_daily")
      .select("provider, calls, est_cost_usd")
      .gte("day", monthStart());
    const agg: Record<string, { calls: number; costUsd: number }> = {};
    for (const r of data || []) {
      const p = (r.provider as string) || "other";
      agg[p] = agg[p] || { calls: 0, costUsd: 0 };
      agg[p].calls += Number(r.calls) || 0;
      agg[p].costUsd += Number(r.est_cost_usd) || 0;
    }
    return Object.entries(agg)
      .map(([provider, v]) => ({ provider, ...v }))
      .sort((a, b) => b.costUsd - a.costUsd);
  } catch (e) {
    logProviderError("cost-guard.byProvider", e, {});
    return [];
  }
}

/** Current spend snapshot for health/diagnostics. */
export async function getSpendSnapshot(): Promise<{
  day: string;
  dayCost: number;
  monthCost: number;
  dailyBudget: number;
  monthlyBudget: number;
  atDailyLimit: boolean;
  atMonthlyLimit: boolean;
  disabled: boolean;
}> {
  await refreshCache();
  const dayCost = cache?.dayCost ?? 0;
  const monthCost = cache?.monthCost ?? 0;
  const dailyBudget = num("LLM_DAILY_BUDGET_USD", 5);
  const monthlyBudget = num("LLM_MONTHLY_BUDGET_USD", 50);
  return {
    day: todayKey(),
    dayCost,
    monthCost,
    dailyBudget,
    monthlyBudget,
    atDailyLimit: dailyBudget > 0 && dayCost >= dailyBudget,
    atMonthlyLimit: monthlyBudget > 0 && monthCost >= monthlyBudget,
    disabled: guardDisabled(),
  };
}
