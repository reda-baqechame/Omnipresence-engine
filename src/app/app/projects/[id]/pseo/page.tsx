import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { PseoPanel } from "@/components/pseo-panel";

export default async function PseoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Programmatic SEO</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Scale location, service, and comparison pages from keyword × location matrices.
        </p>
      </div>
      <PseoPanel projectId={id} />
    </div>
  );
}
