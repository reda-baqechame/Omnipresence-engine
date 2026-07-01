"use client";

import { CapabilityEvidenceBar } from "@/components/capability-evidence-bar";

export function TrafficEvidenceBar({ projectId }: { projectId: string }) {
  return (
    <CapabilityEvidenceBar
      projectId={projectId}
      capability="traffic"
      target=""
      label="Traffic proof"
      quality="estimated"
    />
  );
}
