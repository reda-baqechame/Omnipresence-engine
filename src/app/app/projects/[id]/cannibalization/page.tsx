import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { CannibalizationExplorer } from "@/components/cannibalization-explorer";

export const dynamic = "force-dynamic";

export default async function CannibalizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Keyword / Semantic Cannibalization</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Two pages competing for the same intent split your ranking signals and confuse search + AI engines. This
          crawls your site, embeds page titles with the sovereign embeddings engine, and surfaces near-duplicate pairs
          (cosine similarity ≥ 0.86) you should consolidate or differentiate. Real embeddings only — never fabricated.
        </p>
      </div>
      <CannibalizationExplorer projectId={id} domain={project.domain} />
    </div>
  );
}
