import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { SerpCapturePanel } from "@/components/serp-capture-panel";
import { ExportButtons } from "@/components/export-buttons";

export default async function SerpCapturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">SERP Capture &amp; Decay</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Win featured snippets and People-Also-Ask boxes, and stop content decay before it costs traffic.
          </p>
        </div>
        <ExportButtons projectId={id} types={["snippets"]} />
      </div>
      <SerpCapturePanel projectId={id} />
    </div>
  );
}
