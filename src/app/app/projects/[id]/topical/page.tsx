import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { TopicalPanel } from "@/components/topical-panel";

export default async function TopicalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Topical Authority</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Turn your keyword universe into a hub-and-spoke content architecture, then brief and track each page.
        </p>
      </div>
      <TopicalPanel projectId={id} />
    </div>
  );
}
