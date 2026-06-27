import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CoverageMap } from "@/components/coverage-map";
import { ExportButtons } from "@/components/export-buttons";
import { getProject } from "@/lib/projects";
import type { CoverageItem } from "@/types/database";

export default async function CoveragePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const { data: coverage } = await supabase
    .from("coverage_items")
    .select("*")
    .eq("project_id", id)
    .order("platform_name");

  const items = (coverage || []) as CoverageItem[];
  const present = items.filter((i) => i.is_present).length;
  const competitorGaps = items.filter((i) => !i.is_present && i.competitor_present).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Platform Coverage Map</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {present} of {items.length} surfaces present for {project.domain}
            {competitorGaps > 0 && ` — competitors active on ${competitorGaps} gaps`}
          </p>
        </div>
        <ExportButtons projectId={id} types={["coverage"]} />
      </div>
      <CoverageMap items={items} />
    </div>
  );
}
