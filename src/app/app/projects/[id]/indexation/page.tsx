import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { IndexationPanel } from "@/components/indexation-panel";

export default async function IndexationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Indexation &amp; AI Crawlers</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Control what gets indexed and prove AI + search bots actually crawl your important pages.
        </p>
      </div>
      <IndexationPanel projectId={id} />
    </div>
  );
}
