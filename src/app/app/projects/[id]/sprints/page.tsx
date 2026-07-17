import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { SprintPanel } from "@/components/sprint-panel";

export default async function SprintsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Action Sprints</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          One focused batch of fixes per week, built from your measured gaps. Starting a sprint
          captures a visibility baseline; completing it remeasures and reports an honest outcome —
          increased, unchanged, declined, or inconclusive when the sample is too thin to say.
        </p>
      </div>
      <SprintPanel projectId={id} />
    </div>
  );
}
