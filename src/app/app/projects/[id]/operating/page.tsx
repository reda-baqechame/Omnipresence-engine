import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { OperatingPlanPanel } from "@/components/operating-plan-panel";

export default async function OperatingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Operating System</h2>
        <p className="text-sm text-muted-foreground mt-1">
          The 90-day playbook on autopilot: auto-verified guarantees, the master plan, and the
          daily/weekly/monthly/quarterly review loop that turns findings into tracked tasks.
        </p>
      </div>
      <OperatingPlanPanel projectId={id} />
    </div>
  );
}
