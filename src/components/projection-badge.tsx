"use client";

/**
 * Compact chip for projected/heuristic metrics — always visible next to the number.
 */
export function ProjectionBadge({
  label = "Projected",
  detail,
  className,
}: {
  label?: string;
  detail?: string;
  className?: string;
}) {
  return (
    <span
      title={detail || "Industry benchmark or model estimate — not a measured value from your connected data."}
      className={`inline-flex items-center rounded border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-yellow-400 ${className ?? ""}`}
    >
      {label}
    </span>
  );
}
