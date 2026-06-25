import { notFound } from "next/navigation";
import { BacklinksPanel } from "@/components/backlinks-panel";
import { getProject } from "@/lib/projects";

export default async function BacklinksPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Backlinks</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor referring domains, new links, and losses over time for {project.domain}.
        </p>
      </div>
      <BacklinksPanel projectId={id} />
    </div>
  );
}
