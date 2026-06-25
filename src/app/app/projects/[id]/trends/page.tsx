import { notFound } from "next/navigation";
import { TrendsPanel } from "@/components/trends-panel";
import { getProject } from "@/lib/projects";

export default async function TrendsPage({
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
        <h2 className="text-xl font-semibold">Trends</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Industry-matched trend signals for timely content and pSEO opportunities.
        </p>
      </div>
      <TrendsPanel projectId={id} industry={project.industry || ""} />
    </div>
  );
}
