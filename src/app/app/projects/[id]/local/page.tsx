import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { LocalPanel } from "@/components/local-panel";

export default async function LocalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Local SEO</h2>
        <p className="text-sm text-muted-foreground mt-1">
          GBP audit, map-grid rank tracking, review velocity, NAP consistency, and local landing pages —
          everything to dominate Maps and &quot;near me&quot; for {project.domain}.
        </p>
      </div>
      <LocalPanel projectId={id} />
    </div>
  );
}
