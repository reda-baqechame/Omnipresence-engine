import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { SerpCapturePanel } from "@/components/serp-capture-panel";
import { SerpIntelligenceExplorer } from "@/components/serp-intelligence-explorer";
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

      <div className="rounded-xl border border-border p-4">
        <h3 className="font-semibold">SERP Intelligence explorer</h3>
        <p className="text-sm text-muted-foreground mt-1 mb-3">
          Capture the live SERP for any query and deconstruct every feature — organic, ads, People-Also-Ask, local
          pack, featured snippet, and AI Overview (with its cited domains). Every capture is stored as tamper-evident
          measurement evidence.
        </p>
        <SerpIntelligenceExplorer projectId={id} />
      </div>

      <SerpCapturePanel projectId={id} />
    </div>
  );
}
