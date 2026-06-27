import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { TasksBoard } from "@/components/tasks-board";
import { ExportButtons } from "@/components/export-buttons";

export default async function TasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Execution Tasks</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Every finding, gap, and roadmap item becomes a tracked action. Completed technical fixes
            are auto-verified on your next re-scan with a before/after score.
          </p>
        </div>
        <ExportButtons projectId={id} types={["tasks", "ledger"]} />
      </div>
      <TasksBoard projectId={id} />
    </div>
  );
}
