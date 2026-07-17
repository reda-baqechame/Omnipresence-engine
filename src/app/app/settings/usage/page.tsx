import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getApiUsageSummary } from "@/lib/metering/api-usage";
import { FREE_ACCESS_MODE } from "@/lib/config/access";
import { getSpendSnapshot, getSpendByProvider } from "@/lib/providers/cost-guard";
import { getMonthlyObservationBudget, getOrganizationPlan } from "@/lib/plans/limits";
import { getActiveScanEngines } from "@/lib/config/scan-engines";

const WEEKS_PER_MONTH = 4.33;

/**
 * Schedule fits / doesn't fit (Master Plan v4 guardrail): project the org's
 * monthly observation load from its real tracked prompts × configured engines ×
 * weekly cadence and compare against the plan budget — so a limit is never a
 * mid-month surprise.
 */
async function getObservationForecast(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string
) {
  const plan = await getOrganizationPlan(supabase, organizationId);
  const budget = getMonthlyObservationBudget(plan);

  const monthStart = `${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`;
  const { data: monthUsage } = await supabase
    .from("api_usage")
    .select("credits_used")
    .eq("organization_id", organizationId)
    .gte("created_at", monthStart);
  const usedThisMonth = (monthUsage || []).reduce(
    (a, r) => a + (Number(r.credits_used) || 0),
    0
  );

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, status")
    .eq("organization_id", organizationId)
    .eq("status", "active");
  const projectIds = (projects || []).map((p) => p.id);

  let trackedPrompts = 0;
  if (projectIds.length > 0) {
    const { count } = await supabase
      .from("prompts")
      .select("id", { count: "exact", head: true })
      .in("project_id", projectIds)
      .eq("is_tracked", true);
    trackedPrompts = count ?? 0;
  }

  const engineCount = getActiveScanEngines().length;
  const projectedMonthly = Math.round(trackedPrompts * engineCount * WEEKS_PER_MONTH);

  return {
    plan,
    budget,
    usedThisMonth,
    projects: projects?.length ?? 0,
    trackedPrompts,
    engineCount,
    projectedMonthly,
    fits: !Number.isFinite(budget) || projectedMonthly <= budget,
  };
}

export default async function UsagePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user!.id)
    .limit(1)
    .single();

  const usage = membership
    ? await getApiUsageSummary(supabase, membership.organization_id)
    : { used: 0, limit: 0, byProvider: {} };

  const [spend, spendByProvider, forecast] = await Promise.all([
    getSpendSnapshot().catch(() => null),
    getSpendByProvider().catch(() => []),
    membership
      ? getObservationForecast(supabase, membership.organization_id).catch(() => null)
      : Promise.resolve(null),
  ]);

  const dayPct =
    spend && spend.dailyBudget > 0
      ? Math.min(100, Math.round((spend.dayCost / spend.dailyBudget) * 100))
      : 0;
  const monthPct =
    spend && spend.monthlyBudget > 0
      ? Math.min(100, Math.round((spend.monthCost / spend.monthlyBudget) * 100))
      : 0;

  const usedPct =
    forecast && Number.isFinite(forecast.budget) && forecast.budget > 0
      ? Math.min(100, Math.round((forecast.usedThisMonth / forecast.budget) * 100))
      : 0;

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-semibold mb-2">API Usage</h2>

      {forecast && (
        <div className="bg-card border border-border rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-medium">Observation budget</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
              {forecast.plan} plan
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            An observation = one prompt × one engine × one run. It&apos;s the only meter on
            your plan — every feature is included.
          </p>

          <div className="mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Used this month</span>
              <span>
                {forecast.usedThisMonth.toLocaleString()}
                {Number.isFinite(forecast.budget)
                  ? ` / ${forecast.budget.toLocaleString()}`
                  : " (unlimited)"}
              </span>
            </div>
            {Number.isFinite(forecast.budget) && (
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full ${usedPct >= 90 ? "bg-amber-500" : "bg-primary"}`}
                  style={{ width: `${usedPct}%` }}
                />
              </div>
            )}
          </div>

          <div
            className={`rounded-lg border p-3 text-sm ${
              forecast.fits
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-amber-500/40 bg-amber-500/5"
            }`}
          >
            <div className="font-medium mb-1">
              {forecast.fits
                ? "✓ Your current schedule fits your plan"
                : "Your current schedule exceeds your plan budget"}
            </div>
            <p className="text-muted-foreground text-xs">
              {forecast.trackedPrompts.toLocaleString()} tracked prompts ×{" "}
              {forecast.engineCount} engines × weekly panels ≈{" "}
              {forecast.projectedMonthly.toLocaleString()} observations/month
              {Number.isFinite(forecast.budget)
                ? ` against a ${forecast.budget.toLocaleString()} budget.`
                : "."}
              {!forecast.fits && (
                <>
                  {" "}
                  Untrack some prompts, or{" "}
                  <Link href="/app/settings/billing" className="text-primary underline">
                    upgrade your plan
                  </Link>{" "}
                  — scans never silently overcharge; they pause at the budget.
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {spend && (
        <div className="bg-card border border-border rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">LLM cost guard</h3>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                spend.disabled
                  ? "bg-amber-500/15 text-amber-600"
                  : "bg-emerald-500/15 text-emerald-600"
              }`}
            >
              {spend.disabled ? "disabled" : "active"}
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Today</span>
                <span className={spend.atDailyLimit ? "text-amber-600 font-medium" : ""}>
                  ${spend.dayCost.toFixed(2)} / ${spend.dailyBudget.toFixed(2)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full ${spend.atDailyLimit ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${dayPct}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">This month</span>
                <span className={spend.atMonthlyLimit ? "text-amber-600 font-medium" : ""}>
                  ${spend.monthCost.toFixed(2)} / ${spend.monthlyBudget.toFixed(2)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full ${spend.atMonthlyLimit ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${monthPct}%` }}
                />
              </div>
            </div>
          </div>

          {spendByProvider.length > 0 && (
            <div className="mt-5 pt-4 border-t border-border space-y-2">
              {spendByProvider.map((p) => (
                <div key={p.provider} className="flex justify-between text-sm">
                  <span className="capitalize text-muted-foreground">{p.provider}</span>
                  <span>
                    ${p.costUsd.toFixed(2)}{" "}
                    <span className="text-muted-foreground">({p.calls} calls)</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground mt-4">
            Paid AI calls stop automatically when a budget is reached — scans degrade to
            &quot;unavailable&quot; instead of overspending. Tune limits with the
            <code className="mx-1">LLM_DAILY_BUDGET_USD</code> /
            <code className="mx-1">LLM_MONTHLY_BUDGET_USD</code> env vars.
          </p>
        </div>
      )}
      {FREE_ACCESS_MODE && (
        <p className="text-sm text-muted-foreground mb-6">
          Full free access — usage is tracked for visibility but not limited.
        </p>
      )}

      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-muted-foreground">Operations logged</span>
          <span>{usage.used.toLocaleString()}</span>
        </div>
        {FREE_ACCESS_MODE ? (
          <p className="text-xs text-primary">Unlimited access enabled</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {usage.used.toLocaleString()} / {usage.limit.toLocaleString()} credits
          </p>
        )}
      </div>

      {Object.keys(usage.byProvider).length > 0 && (
        <div>
          <h3 className="font-medium mb-3">By Provider</h3>
          <div className="space-y-2">
            {Object.entries(usage.byProvider).map(([provider, credits]) => (
              <div key={provider} className="flex justify-between bg-card border border-border rounded-lg px-4 py-2 text-sm">
                <span className="capitalize">{provider}</span>
                <span>{credits} credits</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
