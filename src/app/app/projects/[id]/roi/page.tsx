import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { RoiCommandPanel } from "@/components/roi-command-panel";

export default async function RoiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">ROI Command Center</h2>
        <p className="text-sm text-muted-foreground mt-1">
          One view that proves money: organic, AI, social, leads, revenue, and paid-ad-equivalent value — with provenance.
        </p>
      </div>
      <RoiCommandPanel projectId={id} />
    </div>
  );
}
