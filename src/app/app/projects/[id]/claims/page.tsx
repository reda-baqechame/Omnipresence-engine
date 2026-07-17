import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { ClaimReviewPanel } from "@/components/claim-review-panel";

export default async function ClaimsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Claim Review</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          What are AI engines saying about {project.name} that isn&apos;t true? Each review
          checks the captured answers (your receipts) against your own site&apos;s facts and flags
          contradicted or unsupported statements — with the receipt attached, so you can verify the
          answer really said it.
        </p>
      </div>
      <ClaimReviewPanel projectId={id} />
    </div>
  );
}
