"use client";

import { EvidenceDrawer } from "@/components/evidence-drawer";
import { ProvenanceBadge } from "@/components/provenance-badge";

interface CapabilityEvidenceBarProps {
  projectId: string;
  capability: string;
  target?: string;
  label: string;
  quality?: "measured" | "estimated" | "unavailable";
  confidence?: number | null;
}

/** Shared provenance + evidence drawer header for capability panels. */
export function CapabilityEvidenceBar({
  projectId,
  capability,
  target = "",
  label,
  quality = "measured",
  confidence,
}: CapabilityEvidenceBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <ProvenanceBadge quality={quality} confidence={confidence} />
      <EvidenceDrawer projectId={projectId} capability={capability} target={target} label={label} />
    </div>
  );
}
