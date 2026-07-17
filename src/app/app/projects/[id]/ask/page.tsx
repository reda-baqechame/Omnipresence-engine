import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { AskPanel } from "@/components/ask-panel";

export default async function AskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-semibold">Ask</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Ask questions over {project.name}&apos;s own panel and receipt data — per-engine
          rates, sprint outcomes, cited domains, claim reviews.
        </p>
      </div>
      <AskPanel projectId={id} />
    </div>
  );
}
