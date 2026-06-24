import { cn } from "@/lib/utils";
import { getScoreLabel, getScoreColor } from "@/lib/scoring/omnipresence";

interface ScoreGaugeProps {
  score: number;
  label?: string;
  size?: "sm" | "md" | "lg";
}

export function ScoreGauge({ score, label, size = "md" }: ScoreGaugeProps) {
  const { label: scoreLabel } = getScoreLabel(score);
  const sizeClasses = { sm: "text-2xl", md: "text-4xl", lg: "text-6xl" };

  return (
    <div className="text-center">
      <div className={cn("font-extrabold", sizeClasses[size])}>
        <span className={getScoreColor(score).replace("bg-", "text-")}>{Math.round(score)}</span>
        <span className="text-muted-foreground text-lg">/100</span>
      </div>
      {label && <div className="text-sm text-muted-foreground mt-1">{label}</div>}
      <div className="text-xs font-medium mt-0.5 opacity-70">{scoreLabel}</div>
    </div>
  );
}

interface SubScoreBarProps {
  label: string;
  score: number;
}

export function SubScoreBar({ label, score }: SubScoreBarProps) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{Math.round(score)}</span>
      </div>
      <div className="h-2 bg-secondary rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", getScoreColor(score))}
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
    </div>
  );
}
