/**
 * Hard monthly call caps for optional free-trial SERP vendors (Serper, Brave).
 *
 * Prevents silent billing once the free allotment is exhausted. Uses the same
 * durable `api_spend_daily` table as the LLM cost guard, keyed by provider id.
 */
import { logProviderError } from "@/lib/observability/log";
import { BudgetExceededError } from "@/lib/providers/cost-guard";

export type CappedProvider = "serper" | "brave";

const DEFAULT_CAPS: Record<CappedProvider, { env: string; defaultCap: number; costPerCall: number }> = {
  serper: { env: "SERPER_MONTHLY_CAP", defaultCap: 2500, costPerCall: 0.001 },
  brave: { env: "BRAVE_MONTHLY_CAP", defaultCap: 2000, costPerCall: 0 },
};

function num(envKey: string, dflt: number): number {
  const v = Number(process.env[envKey]);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
}

function monthStart(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

function capsDisabled(): boolean {
  return process.env.PROVIDER_CALL_CAPS_DISABLED === "true";
}

async function serviceClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const cache = new Map<CappedProvider, { calls: number; fetchedAt: number }>();
const CACHE_TTL_MS = 60_000;

async function monthCalls(provider: CappedProvider): Promise<number> {
  const cached = cache.get(provider);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.calls;
  try {
    const sb = await serviceClient();
    if (!sb) return 0;
    const { data } = await sb
      .from("api_spend_daily")
      .select("calls")
      .eq("provider", provider)
      .gte("day", monthStart());
    const calls = (data || []).reduce((a, r) => a + (Number(r.calls) || 0), 0);
    cache.set(provider, { calls, fetchedAt: Date.now() });
    return calls;
  } catch (e) {
    logProviderError("provider-call-cap.read", e, { provider });
    return cached?.calls ?? 0;
  }
}

export function monthlyCapFor(provider: CappedProvider): number {
  const cfg = DEFAULT_CAPS[provider];
  return Math.floor(num(cfg.env, cfg.defaultCap));
}

/** True when the provider may still be used this month. */
export async function isProviderCallAllowed(provider: CappedProvider): Promise<boolean> {
  if (capsDisabled()) return true;
  const cap = monthlyCapFor(provider);
  if (cap <= 0) return true;
  const used = await monthCalls(provider);
  return used < cap;
}

/**
 * Throws BudgetExceededError when the monthly free-trial cap is hit.
 * Call BEFORE every Serper/Brave request.
 */
export async function assertProviderCallAllowed(provider: CappedProvider): Promise<void> {
  if (capsDisabled()) return;
  const cap = monthlyCapFor(provider);
  if (cap <= 0) return;
  const used = await monthCalls(provider);
  if (used >= cap) {
    throw new BudgetExceededError(`${provider} monthly cap ${cap} reached (used ~${used})`);
  }
}

/** Record one vendor call after a successful request. */
export async function recordProviderCall(provider: CappedProvider): Promise<void> {
  if (capsDisabled()) return;
  const cfg = DEFAULT_CAPS[provider];
  const day = new Date().toISOString().slice(0, 10);
  const cached = cache.get(provider);
  if (cached) {
    cached.calls += 1;
    cached.fetchedAt = Date.now();
  }
  try {
    const sb = await serviceClient();
    if (!sb) return;
    await sb.rpc("increment_api_spend", {
      p_day: day,
      p_provider: provider,
      p_calls: 1,
      p_in: 0,
      p_out: 0,
      p_cost: cfg.costPerCall,
    });
  } catch (e) {
    logProviderError("provider-call-cap.record", e, { provider });
  }
}

export async function getProviderCallSnapshot(): Promise<
  Array<{ provider: CappedProvider; cap: number; used: number; remaining: number; atCap: boolean }>
> {
  const out: Array<{ provider: CappedProvider; cap: number; used: number; remaining: number; atCap: boolean }> = [];
  for (const provider of Object.keys(DEFAULT_CAPS) as CappedProvider[]) {
    const cap = monthlyCapFor(provider);
    const used = await monthCalls(provider);
    out.push({
      provider,
      cap,
      used,
      remaining: cap > 0 ? Math.max(0, cap - used) : Infinity,
      atCap: cap > 0 && used >= cap,
    });
  }
  return out;
}
