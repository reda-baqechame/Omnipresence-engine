import { notFound } from "next/navigation";
import { KeywordsPanel } from "@/components/keywords-panel";
import { ExportButtons } from "@/components/export-buttons";
import { getProject } from "@/lib/projects";

export default async function KeywordsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Keyword Intelligence</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Live keyword research, SERP difficulty, content gaps vs competitors, and backlink gap analysis.
          </p>
        </div>
        <ExportButtons projectId={id} types={["keywords", "content_gaps"]} />
      </div>
      <KeywordsPanel projectId={id} industry={project.industry || ""} />
    </div>
  );
}
