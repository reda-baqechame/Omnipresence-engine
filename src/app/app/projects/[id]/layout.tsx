import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { ProjectTabs } from "@/components/project-tabs";
import { ProjectOsNav } from "@/components/project-os-nav";
import { ExportReportButton } from "@/components/export-report-button";
import { getProject } from "@/lib/projects";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div>
      <Link
        href="/app/projects"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Projects
      </Link>

      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-3xl font-bold">{project.name}</h1>
          <p className="text-muted-foreground">
            {project.domain} · {project.industry} ·{" "}
            <span
              className={
                project.status === "scanning"
                  ? "text-yellow-400"
                  : project.status === "active"
                    ? "text-green-400"
                    : ""
              }
            >
              {project.status}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <form action={`/api/projects/${id}/rescan`} method="POST">
            <button
              type="submit"
              className="border border-border px-3 py-2 rounded-lg text-sm flex items-center gap-1 hover:bg-secondary transition"
            >
              <RefreshCw className="h-4 w-4" /> Re-scan
            </button>
          </form>
          <ExportReportButton projectId={id} />
        </div>
      </div>

      <ProjectTabs projectId={id} />
      <div className="flex items-start gap-0">
        <ProjectOsNav projectId={id} />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
