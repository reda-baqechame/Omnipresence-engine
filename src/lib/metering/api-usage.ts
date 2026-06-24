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

export async function assertApiCredits(
  _supabase: SupabaseClient,
  _organizationId: string,
  _credits: number
): Promise<void> {
  if (FREE_ACCESS_MODE) return;
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
