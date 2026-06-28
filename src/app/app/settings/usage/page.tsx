import { createClient } from "@/lib/supabase/server";
import { getApiUsageSummary } from "@/lib/metering/api-usage";
import { FREE_ACCESS_MODE } from "@/lib/config/access";
import { getSpendSnapshot, getSpendByProvider } from "@/lib/providers/cost-guard";

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

  const [spend, spendByProvider] = await Promise.all([
    getSpendSnapshot().catch(() => null),
    getSpendByProvider().catch(() => []),
  ]);

  const dayPct =
    spend && spend.dailyBudget > 0
      ? Math.min(100, Math.round((spend.dayCost / spend.dailyBudget) * 100))
      : 0;
  const monthPct =
    spend && spend.monthlyBudget > 0
      ? Math.min(100, Math.round((spend.monthCost / spend.monthlyBudget) * 100))
      : 0;

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-semibold mb-2">API Usage</h2>

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
