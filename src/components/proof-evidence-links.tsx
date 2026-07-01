"use client";

import { EvidenceDrawer } from "@/components/evidence-drawer";

export function ProofEvidenceLinks({ projectId }: { projectId: string }) {
  return (
    <div className="flex flex-wrap gap-3 text-sm">
      <EvidenceDrawer projectId={projectId} capability="visibility" target="" label="AI visibility proof" />
      <EvidenceDrawer projectId={projectId} capability="rank" target="" label="Rank proof" />
      <EvidenceDrawer projectId={projectId} capability="source_graph" target={projectId} label="Source graph proof" />
      <EvidenceDrawer projectId={projectId} capability="backlink_graph" target="snapshot" label="Backlink proof" />
    </div>
  );
}
