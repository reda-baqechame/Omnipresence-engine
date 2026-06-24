import { createClient } from "@/lib/supabase/server";
import { getApiUsageSummary } from "@/lib/metering/api-usage";
import { FREE_ACCESS_MODE } from "@/lib/config/access";

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

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-semibold mb-2">API Usage</h2>
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
