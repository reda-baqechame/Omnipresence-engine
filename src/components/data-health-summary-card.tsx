import Link from "next/link";
import { ShieldCheck, ShieldAlert } from "lucide-react";

export interface DataHealthSummaryCardProps {
  projectId: string;
  measuredDimensions: number;
  totalDimensions: number;
  activeProviderCount: number;
  missingProviderCount: number;
}

/**
 * Compact, glanceable data-health readout for the project overview (the most
 * viewed page). Previously the only way to see how much of a score was
 * actually measured vs. missing was to navigate into the separate Data Trust
 * Center — an important trust signal that was one click too deep for a page
 * users check daily. Server-rendered from data the page already fetches so
 * it doesn't add another client round trip.
 */
export function DataHealthSummaryCard({
  projectId,
  measuredDimensions,
  totalDimensions,
  activeProviderCount,
  missingProviderCount,
}: DataHealthSummaryCardProps) {
  const allMeasured = totalDimensions > 0 && measuredDimensions === totalDimensions;

  return (
    <Link
      href={`/app/projects/${projectId}/trust`}
      className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 hover:bg-secondary/40 transition"
    >
      <div className="flex items-center gap-3">
        {allMeasured ? (
          <ShieldCheck className="h-5 w-5 text-green-400 shrink-0" aria-hidden />
        ) : (
          <ShieldAlert className="h-5 w-5 text-yellow-400 shrink-0" aria-hidden />
        )}
        <div>
          <p className="text-sm font-medium">
            {measuredDimensions}/{totalDimensions} score dimensions measured
          </p>
          <p className="text-xs text-muted-foreground">
            {activeProviderCount} data source{activeProviderCount === 1 ? "" : "s"} active
            {missingProviderCount > 0 && (
              <>
                {" · "}
                <span className="text-yellow-500">
                  {missingProviderCount} not connected
                </span>
              </>
            )}
          </p>
        </div>
      </div>
      <span className="text-xs text-primary hover:underline shrink-0">View data trust →</span>
    </Link>
  );
}
