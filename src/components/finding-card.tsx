import { cn } from "@/lib/utils";
import type { FindingSeverity } from "@/types/database";

const SEVERITY_STYLES: Record<FindingSeverity, string> = {
  critical: "border-l-red-500 bg-red-500/5",
  high: "border-l-orange-500 bg-orange-500/5",
  medium: "border-l-yellow-500 bg-yellow-500/5",
  low: "border-l-blue-500 bg-blue-500/5",
  info: "border-l-gray-500 bg-gray-500/5",
};

interface FindingCardProps {
  title: string;
  description: string;
  severity: FindingSeverity;
  fix?: string;
  category?: string;
}

export function FindingCard({ title, description, severity, fix, category }: FindingCardProps) {
  return (
    <div className={cn("border-l-4 rounded-r-lg p-4", SEVERITY_STYLES[severity])}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wide opacity-70">{severity}</span>
        {category && <span className="text-xs text-muted-foreground">· {category}</span>}
      </div>
      <h3 className="font-semibold text-sm">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
      {fix && (
        <p className="text-sm mt-2">
          <span className="font-medium text-primary">Fix:</span> {fix}
        </p>
      )}
    </div>
  );
}
