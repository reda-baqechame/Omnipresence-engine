import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { BehaviorPanel } from "@/components/behavior-panel";

export default async function BehaviorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Behavior</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Free behavioral analytics for {project.domain} via Microsoft Clarity — scroll depth, rage/dead clicks,
          and quickbacks turned into prioritized UX fixes.
        </p>
      </div>
      <BehaviorPanel projectId={id} />
    </div>
  );
}
