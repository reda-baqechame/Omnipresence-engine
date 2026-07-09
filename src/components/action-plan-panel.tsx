import Link from "next/link";
import { ArrowRight, Target } from "lucide-react";
import type { ActionPlan } from "@/lib/engines/action-plan";
import type { TaskPriority } from "@/types/database";
import { ProjectionBadge } from "@/components/projection-badge";
import { EvidenceDrawer } from "@/components/evidence-drawer";

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
        {plan.totalEffort > 0 && (
          <>
            {" "}
            About {effortLabel(plan.totalEffort)} of focused work
            <ProjectionBadge label="Est. effort" detail="Heuristic hours from task category — not a measured time tracking." className="ml-1 align-middle" />
          </>
        )}
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
              {item.evidenceCitation && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p className="text-xs text-muted-foreground italic line-clamp-2" title={item.evidenceCitation}>
                    Evidence: {item.evidenceCitation}
                  </p>
                  <EvidenceDrawer
                    projectId={projectId}
                    capability={(item.category || "action_plan").toLowerCase()}
                    target={item.id}
                    label="Why this recommendation"
                    className="text-xs shrink-0"
                  />
                </div>
              )}
              {item.description && !item.evidenceCitation && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
              )}
              {item.description && item.evidenceCitation && item.description !== item.evidenceCitation && (
                <p className="text-xs text-muted-foreground/80 mt-0.5 line-clamp-1">{item.description}</p>
              )}
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                {item.ownedEarned && item.ownedEarned !== "unknown" && (
                  <>
                    <span className="capitalize">{item.ownedEarned}</span>
                    <span>·</span>
                  </>
                )}
                <span>Impact {Math.round(item.impact)}/100</span>
                <ProjectionBadge label="Est." detail="Impact score is a projected heuristic for prioritization." className="scale-90" />
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
