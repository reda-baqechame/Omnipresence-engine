import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { SourceGraphPanel } from "@/components/source-graph-panel";

export default async function SourceGraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Source Graph</h2>
        <p className="text-sm text-muted-foreground mt-1">
          The market-specific map of how AI answers are formed: prompt clusters, the engines that
          answer them, the third-party sources those engines cite, and the competitors vs your brand
          behind each source. Built only from measured citation data.
        </p>
      </div>
      <SourceGraphPanel projectId={id} />
    </div>
  );
}
