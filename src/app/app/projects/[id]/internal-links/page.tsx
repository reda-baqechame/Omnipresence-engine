import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { InternalLinksPanel } from "@/components/internal-links-panel";

export default async function InternalLinksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Internal Linking</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Discover where to add internal links to push authority to commercial pages.
        </p>
      </div>
      <InternalLinksPanel projectId={id} />
    </div>
  );
}
