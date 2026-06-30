import type { SupabaseClient } from "@supabase/supabase-js";
import { FREE_ACCESS_MODE, UNLIMITED_API_CREDITS } from "@/lib/config/access";

export async function trackApiUsage(
  supabase: SupabaseClient,
  organizationId: string,
  provider: string,
  operation: string,
  credits = 1
): Promise<{ allowed: boolean; remaining: number }> {
  if (FREE_ACCESS_MODE) {
    try {
      await supabase.from("api_usage").insert({
        organization_id: organizationId,
        provider,
        operation,
        credits_used: credits,
      });
    } catch {
      // Usage logging is best-effort
    }
    return { allowed: true, remaining: UNLIMITED_API_CREDITS };
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("api_credits_used")
    .eq("id", organizationId)
    .single();

  const used = org?.api_credits_used || 0;

  await supabase.from("api_usage").insert({
    organization_id: organizationId,
    provider,
    operation,
    credits_used: credits,
  });

  await supabase
    .from("organizations")
    .update({ api_credits_used: used + credits })
    .eq("id", organizationId);

  return { allowed: true, remaining: UNLIMITED_API_CREDITS };
}

export class ApiCreditExceededError extends Error {
  constructor() {
    super("API credit limit exceeded");
    this.name = "ApiCreditExceededError";
  }
}

export class TenantBudgetExceededError extends Error {
  constructor(public reason: string) {
    super(`tenant-budget: ${reason}`);
    this.name = "TenantBudgetExceededError";
  }
}

export async function assertApiCredits(
  _supabase: SupabaseClient,
  _organizationId: string,
  _credits: number
): Promise<void> {
  if (FREE_ACCESS_MODE) return;
}

/**
 * Per-tenant daily surface-measurement budget (Wave T3 cost hardening).
 *
 * Even with free access, one noisy tenant must not be able to burn the platform
 * owner's shared paid-API spend (grounded probes, SERP) for everyone. When
 * TENANT_DAILY_CREDIT_CAP > 0, this caps how many measurement credits a single
 * organization can consume per UTC day. Fail-open on read errors so a DB blip
 * never wrongly blocks a paying tenant. Throws TenantBudgetExceededError when
 * the cap is hit — callers degrade the affected engine to "unavailable".
 */
export async function assertTenantSurfaceBudget(
  supabase: SupabaseClient,
  organizationId: string,
  pendingCredits = 1
): Promise<void> {
  const cap = Number(process.env.TENANT_DAILY_CREDIT_CAP);
  if (!Number.isFinite(cap) || cap <= 0) return; // disabled by default

  try {
    const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
    const { data } = await supabase
      .from("api_usage")
      .select("credits_used")
      .eq("organization_id", organizationId)
      .gte("created_at", dayStart);
    const usedToday = (data || []).reduce((a, r) => a + (Number(r.credits_used) || 0), 0);
    if (usedToday + pendingCredits > cap) {
      throw new TenantBudgetExceededError(
        `org ${organizationId} hit daily cap ${cap} (used ~${usedToday})`
      );
    }
  } catch (e) {
    if (e instanceof TenantBudgetExceededError) throw e;
    // Fail-open on read errors.
  }
}

export async function getApiUsageSummary(
  supabase: SupabaseClient,
  organizationId: string
): Promise<{ used: number; limit: number; byProvider: Record<string, number> }> {
  const { data: org } = await supabase
    .from("organizations")
    .select("api_credits_used")
    .eq("id", organizationId)
    .single();

  const { data: usage } = await supabase
    .from("api_usage")
    .select("provider, credits_used")
    .eq("organization_id", organizationId);

  const byProvider: Record<string, number> = {};
  for (const row of usage || []) {
    byProvider[row.provider] = (byProvider[row.provider] || 0) + row.credits_used;
  }

  const used = org?.api_credits_used || Object.values(byProvider).reduce((a, b) => a + b, 0);

  return {
    used,
    limit: UNLIMITED_API_CREDITS,
    byProvider,
  };
}
