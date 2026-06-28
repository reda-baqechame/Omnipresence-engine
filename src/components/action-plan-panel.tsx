import Link from "next/link";
import { ArrowRight, Target } from "lucide-react";
import type { ActionPlan } from "@/lib/engines/action-plan";
import type { TaskPriority } from "@/types/database";

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  critical: "text-red-400 bg-red-500/10 border-red-500/30",
  high: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  low: "text-blue-400 bg-blue-500/10 border-blue-500/30",
};

function effortLabel(hours: number): string {
  if (hours <= 1) return "~1h";
  if (hours <= 3) return `~${hours}h`;
  if (hours <= 8) return "~1 day";
  return `~${Math.round(hours / 8)} days`;
}

export function ActionPlanPanel({ projectId, plan }: { projectId: string; plan: ActionPlan }) {
  if (!plan.topMove) return null;

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" /> Do this week
        </h2>
        <Link href={`/app/projects/${projectId}/tasks`} className="text-sm text-primary hover:underline whitespace-nowrap">
          All tasks <ArrowRight className="inline h-3.5 w-3.5" />
        </Link>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Your highest-leverage moves, ranked by impact per hour.
        {plan.totalEffort > 0 && ` About ${effortLabel(plan.totalEffort)} of focused work`}
        {plan.remaining > 0 && ` · ${plan.remaining} more queued`}.
      </p>

      <ol className="space-y-2">
        {plan.thisWeek.map((item, i) => (
          <li
            key={item.id}
            className="flex items-start gap-3 rounded-lg border border-border bg-background/40 p-3"
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${PRIORITY_STYLE[item.priority]}`}>
                  {item.priority}
                </span>
                <p className="text-sm font-medium leading-snug">{item.title}</p>
              </div>
              {item.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
              )}
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span>Impact {Math.round(item.impact)}/100</span>
                <span>·</span>
                <span>{effortLabel(item.effort)}</span>
                {item.href && (
                  <>
                    <span>·</span>
                    <Link href={item.href} className="text-primary hover:underline">
                      Act in {item.surface}
                    </Link>
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
