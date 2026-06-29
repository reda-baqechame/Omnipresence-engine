import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { ProofLedgerPanel } from "@/components/proof-ledger-panel";

export default async function ProofLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Proof Ledger</h2>
        <p className="text-sm text-muted-foreground mt-1">
          The full, filterable timeline of every executed action with its before/after snapshot and
          verification trail. This is the deterministic evidence behind the refund-shield guarantee —
          outcomes we caused, recorded as they happened.
        </p>
      </div>
      <ProofLedgerPanel projectId={id} />
    </div>
  );
}
