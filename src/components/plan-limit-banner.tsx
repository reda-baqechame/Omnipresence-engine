import Link from "next/link";

/**
 * Soft-overage moment (Master Plan v4): when a capacity limit stops an action,
 * the user sees exactly what happened and a one-click path to more capacity —
 * never a raw API error, never a silent overcharge.
 */
export function PlanLimitBanner({ kind }: { kind: string }) {
  const copy =
    kind === "budget"
      ? {
          title: "Monthly observation budget reached",
          body: "Scans pause instead of overcharging you — that's the deal. Your budget resets on the 1st. Want more capacity now?",
        }
      : {
          title: "Plan capacity reached",
          body: "This action needs more capacity than your current plan includes. Every plan has every feature — you only ever pay for capacity.",
        };

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-semibold text-sm">{copy.title}</h2>
        <p className="text-xs text-muted-foreground max-w-xl">{copy.body}</p>
      </div>
      <div className="flex gap-2">
        <Link
          href="/app/settings/usage"
          className="border border-border px-3 py-2 rounded-lg text-sm hover:bg-secondary transition"
        >
          View usage
        </Link>
        <Link
          href="/app/settings/billing"
          className="bg-primary text-primary-foreground px-3 py-2 rounded-lg text-sm hover:opacity-90 transition"
        >
          Upgrade plan
        </Link>
      </div>
    </div>
  );
}
