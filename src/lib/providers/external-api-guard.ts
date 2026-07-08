/**
 * Paid-external-API (DataForSEO/OmniData, Firecrawl) cost guard.
 *
 * cost-guard.ts already protects LLM spend (OpenAI/Anthropic/Gemini/
 * Perplexity) with a rate limit + durable daily/monthly USD budget. DataForSEO
 * and Firecrawl are the platform's other two paid provider accounts —
 * dataForSEORequest()/omniDataGet() (dataforseo.ts) and the Firecrawl search/
 * scrape/crawl calls (firecrawl.ts) had NO guard at all: no rate limit, no
 * budget, callable an unbounded number of times per request. A single
 * pathological deep-report/scan loop (or an unauthenticated caller hammering
 * a route that triggers one) could run up the platform owner's DataForSEO or
 * Firecrawl bill with nothing in the codebase noticing until the invoice
 * arrived.
 *
 * Deliberately a SEPARATE guard from cost-guard.ts rather than reusing its
 * `assertWithinBudget()` — that function's rate limit and $ budget are tuned
 * for cheap, frequent LLM probe calls (default $5/day) and sized in USD per
 * *token*; DataForSEO/Firecrawl bill per *call* at a very different price
 * point, so sharing one pool would either starve LLM calls or make the
 * external-API cap meaningless. Both guards persist to the same
 * `api_spend_daily` ledger (provider-keyed, so `getSpendByProvider()`
 * reporting already covers these providers with no changes) and both use the
 * same fail-open-on-read-error, clean-typed-error-on-limit posture.
 *
 * Disable entirely (not recommended) with EXTERNAL_API_BUDGET_DISABLED=true.
 */

import { logProviderError } from "@/lib/observability/log";
import { getJobContext } from "@/lib/observability/job-context";

export type ExternalApiProvider = "dataforseo" | "firecrawl";

// Conservative flat per-call price estimates (USD). Real DataForSEO pricing
// varies by endpoint (SERP ~$0.002-0.006/call, Labs ~$0.01-0.05/call,
// backlinks ~$0.02+/call); Firecrawl is credit-based (~$0.001-0.005/call
// depending on plan). These deliberately skew high so the guard errs toward
// stopping early rather than under-counting spend — they are ESTIMATES for
// the budget guard only, never billed to anyone.
const CALL_COST_USD: Record<ExternalApiProvider, number> = {
  dataforseo: 0.02,
  firecrawl: 0.01,
};

function num(envKey: string, dflt: number): number {
  const v = Number(process.env[envKey]);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
}

function guardDisabled(): boolean {
  return process.env.EXTERNAL_API_BUDGET_DISABLED === "true";
}

export class ExternalApiBudgetExceededError extends Error {
  reason: string;
  provider: ExternalApiProvider;
  constructor(provider: ExternalApiProvider, reason: string) {
    super(`external-api-guard(${provider}): ${reason}`);
    this.name = "ExternalApiBudgetExceededError";
    this.provider = provider;
    this.reason = reason;
  }
}

// ---- Layer 1: per-instance sliding-window rate limiter (per provider) ----
// Pure runaway-loop protection; the USD budget below is the real money cap.
const callTimes: Record<ExternalApiProvider, number[]> = { dataforseo: [], firecrawl: [] };
function checkRate(provider: ExternalApiProvider): void {
  const limit = Math.floor(num("EXTERNAL_API_MAX_CALLS_PER_MIN", 120));
  if (limit <= 0) return;
  const times = callTimes[provider];
  const now = Date.now();
  const windowStart = now - 60_000;
  while (times.length && times[0] < windowStart) times.shift();
  if (times.length >= limit) {
    throw new ExternalApiBudgetExceededError(provider, `rate limit ${limit}/min exceeded`);
  }
  times.push(now);
}

// ---- Layer 2: durable daily/monthly USD budget (cached to limit DB reads) ----
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

// Combined spend across both external-API providers — a single shared
// budget, since both draw down the same "non-LLM paid API" allowance.
const TRACKED_PROVIDERS: ExternalApiProvider[] = ["dataforseo", "firecrawl"];

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
      .select("day, provider, est_cost_usd")
      .in("provider", TRACKED_PROVIDERS)
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
    logProviderError("external-api-guard.read", e, {});
    if (!cache || cache.day !== day) cache = { day, dayCost: 0, monthCost: 0, fetchedAt: Date.now() };
  }
}

/**
 * Throws ExternalApiBudgetExceededError if the call should be blocked. Call
 * this BEFORE every paid DataForSEO/OmniData or Firecrawl request. Cheap
 * after the first call in a 60s window (cached).
 */
export async function assertWithinExternalApiBudget(provider: ExternalApiProvider): Promise<void> {
  if (guardDisabled()) return;
  checkRate(provider);
  await refreshCache();
  if (cache) {
    const daily = num("EXTERNAL_API_DAILY_BUDGET_USD", 10);
    const monthly = num("EXTERNAL_API_MONTHLY_BUDGET_USD", 150);
    if (daily > 0 && cache.dayCost >= daily) {
      throw new ExternalApiBudgetExceededError(
        provider,
        `daily budget $${daily} reached (spent ~$${cache.dayCost.toFixed(2)})`
      );
    }
    if (monthly > 0 && cache.monthCost >= monthly) {
      throw new ExternalApiBudgetExceededError(
        provider,
        `monthly budget $${monthly} reached (spent ~$${cache.monthCost.toFixed(2)})`
      );
    }
  }
}

/**
 * Record the estimated cost of a completed call. Updates the in-process cache
 * immediately and persists atomically via the same increment_api_spend RPC
 * cost-guard.ts uses. Best-effort: persistence errors are logged, never
 * thrown — a metering blip must never take down a scan/report.
 */
export async function recordExternalApiSpend(provider: ExternalApiProvider, calls = 1): Promise<void> {
  if (guardDisabled()) return;
  const cost = CALL_COST_USD[provider] * calls;

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
      p_calls: calls,
      p_in: 0,
      p_out: 0,
      p_cost: cost,
    });

    const job = getJobContext();
    if (job?.reportId) {
      await sb.rpc("increment_report_usage", {
        p_report_id: job.reportId,
        p_cost: cost,
        p_tokens: 0,
        p_calls: calls,
      });
    }
    if (job?.runId) {
      await sb.rpc("increment_run_usage", {
        p_run_id: job.runId,
        p_cost: cost,
        p_tokens: 0,
        p_calls: calls,
      });
    }
  } catch (e) {
    logProviderError("external-api-guard.record", e, { provider });
  }
}
