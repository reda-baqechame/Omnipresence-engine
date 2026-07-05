"use client";

import type { DataQuality } from "@/types/database";
import { PROVENANCE_META } from "@/lib/engines/provenance";

const TONE_CLASS: Record<string, string> = {
  good: "bg-green-500/10 text-green-400 border-green-500/30",
  warn: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  muted: "bg-secondary text-muted-foreground border-border",
  bad: "bg-red-500/10 text-red-400 border-red-500/30",
};

interface ProvenanceBadgeProps {
  quality: DataQuality | null | undefined;
  confidence?: number | null;
  lastCheckedAt?: string | null;
  provider?: string | null;
  evidenceUrl?: string | null;
  className?: string;
}

/**
 * Honest provenance badge shown next to any metric: Live / Estimated /
 * Model-knowledge / Demo / Unavailable. This is what keeps the platform
 * refund-safe — a user always sees how trustworthy a number is.
 */
export function ProvenanceBadge({
  quality,
  confidence,
  lastCheckedAt,
  provider,
  evidenceUrl,
  className,
}: ProvenanceBadgeProps) {
  const meta = PROVENANCE_META[quality ?? "unavailable"] ?? PROVENANCE_META.unavailable;
  const tone = TONE_CLASS[meta.tone] ?? TONE_CLASS.muted;
  const titleParts = [meta.description];
  if (provider) titleParts.push(`Provider: ${provider}`);
  if (typeof confidence === "number") titleParts.push(`Confidence: ${Math.round(confidence * 100)}%`);
  if (lastCheckedAt) titleParts.push(`Checked: ${new Date(lastCheckedAt).toLocaleDateString()}`);

  const badge = (
    <span
      title={titleParts.join(" ")}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ${tone} ${className ?? ""}`}
    >
      {meta.label}
      {provider ? <span className="opacity-70">{provider}</span> : null}
      {typeof confidence === "number" && meta.tone !== "bad" ? (
        <span className="opacity-70">{Math.round(confidence * 100)}%</span>
      ) : null}
    </span>
  );

  if (!evidenceUrl) return badge;

  return (
    <a href={evidenceUrl} target="_blank" rel="noreferrer" title={`${titleParts.join(" ")} Open evidence.`}>
      {badge}
    </a>
  );
}
