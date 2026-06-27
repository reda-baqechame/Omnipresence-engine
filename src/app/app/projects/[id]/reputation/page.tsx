import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { ReputationPanel } from "@/components/reputation-panel";

export default async function ReputationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Brand & Reputation</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor mentions with sentiment, correct how AI describes {project.domain}, and control your brand SERP.
        </p>
      </div>
      <ReputationPanel projectId={id} />
    </div>
  );
}
