import { notFound } from "next/navigation";
import { IntelligencePanel } from "@/components/intelligence-panel";
import { CompetitorIntel } from "@/components/competitor-intel";
import { getProject } from "@/lib/projects";

export default async function IntelligencePage({
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
        <h2 className="text-xl font-semibold">AEO & Intelligence</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Answer Engine Optimization metrics: share of voice, citation rate, and competitor visibility across AI engines.
        </p>
      </div>
      <IntelligencePanel projectId={id} />
      <CompetitorIntel
        domain={project.domain}
        competitors={project.competitors || []}
        brandName={project.name}
      />
    </div>
  );
}
