import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { DataTrustCenter } from "@/components/data-trust-center";

export default async function TrustPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Data Trust Center</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Per-capability provenance for <strong>{project.domain}</strong> — what is measured, estimated, or unavailable.
          See <code>docs/DATA_CONTRACT.md</code> in the repository for the full data contract.
        </p>
      </div>
      <DataTrustCenter projectId={id} />
    </div>
  );
}
