import Link from "next/link";
import type { ReactNode } from "react";

export interface ProjectHubTool {
  href: string;
  title: string;
  description: string;
  status?: "measured" | "needs-setup" | "workflow";
}

const STATUS_LABEL: Record<NonNullable<ProjectHubTool["status"]>, string> = {
  measured: "Measured data",
  "needs-setup": "Requires integration",
  workflow: "Workflow",
};

export function ProjectHubPage({
  title,
  description,
  projectId,
  tools,
  children,
  toolsHeading = "All tools in this workflow",
}: {
  title: string;
  description: string;
  projectId: string;
  tools: ProjectHubTool[];
  children?: ReactNode;
  toolsHeading?: string;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>

      {children ? <section className="space-y-4">{children}</section> : null}

      <section className="space-y-4">
        <h3 className="text-lg font-semibold">{toolsHeading}</h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tools.map((tool) => (
          <Link
            key={tool.href}
            href={`/app/projects/${projectId}${tool.href}`}
            className="rounded-xl border border-border bg-card p-5 transition hover:border-primary/60 hover:bg-secondary/30"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold">{tool.title}</h3>
              {tool.status ? (
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {STATUS_LABEL[tool.status]}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{tool.description}</p>
          </Link>
        ))}
        </div>
      </section>
    </div>
  );
}
