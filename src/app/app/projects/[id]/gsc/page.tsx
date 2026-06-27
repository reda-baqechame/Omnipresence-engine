import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { GscDashboard } from "@/components/gsc-dashboard";

export default async function GscPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Search Console Insights</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Live per-query and per-page truth from Google Search Console: striking-distance, low-CTR,
          and content decay — the ground truth no estimate can replace.
        </p>
      </div>
      <GscDashboard projectId={id} />
    </div>
  );
}
