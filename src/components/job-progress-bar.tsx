"use client";

import { Loader2, Square } from "lucide-react";

interface JobProgressBarProps {
  label: string;
  subLabel?: string | null;
  progressPercent?: number | null;
  stopping?: boolean;
  onStop?: () => void;
}

/**
 * Reusable inline progress affordance for a single running job (report
 * generation or visibility scan). Shows an indeterminate spinner when no
 * concrete percent is known yet (most jobs today), a determinate bar once
 * progress_percent is populated, and an optional Stop button wired to the
 * cancel API routes.
 */
export function JobProgressBar({ label, subLabel, progressPercent, stopping, onStop }: JobProgressBarProps) {
  const hasPercent = typeof progressPercent === "number" && progressPercent >= 0;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{label}</p>
        {subLabel && <p className="truncate text-xs text-muted-foreground">{subLabel}</p>}
        {hasPercent && (
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, Math.max(0, progressPercent as number))}%` }}
            />
          </div>
        )}
      </div>
      {onStop && (
        <button
          type="button"
          onClick={onStop}
          disabled={stopping}
          title="Stop"
          className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          <Square className="h-3 w-3" />
          {stopping ? "Stopping…" : "Stop"}
        </button>
      )}
    </div>
  );
}
