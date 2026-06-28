import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { IntelligencePanel } from "@/components/intelligence-panel";
import { CompetitorIntel } from "@/components/competitor-intel";
import { getProject } from "@/lib/projects";
import { competitorVisibilityRates, type EntityVisibilityRate } from "@/lib/engines/visibility-insights";
import type { VisibilityResult } from "@/types/database";

export default async function IntelligencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const { data: visibility } = await supabase
    .from("visibility_results")
    .select("*")
    .eq("project_id", id);

  const competitors = project.competitors || [];
  const rates = competitorVisibilityRates((visibility || []) as VisibilityResult[], competitors);
  const aiRates: Record<string, EntityVisibilityRate> = { [project.domain]: rates.brand };
  for (const c of competitors) aiRates[c] = rates.competitors[c];

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
        competitors={competitors}
        brandName={project.name}
        aiRates={aiRates}
      />
    </div>
  );
}
