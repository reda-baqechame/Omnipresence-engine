import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { RankPanel } from "@/components/rank-panel";
import { ExportButtons } from "@/components/export-buttons";

export default async function RanksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Search Rankings</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Track Google positions via OmniData. Striking-distance keywords (positions 4–20) are flagged for quick wins.
          </p>
        </div>
        <ExportButtons projectId={id} types={["ranks", "keywords", "findings", "ledger"]} />
      </div>
      <RankPanel projectId={id} />
    </div>
  );
}
