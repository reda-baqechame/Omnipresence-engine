import { notFound } from "next/navigation";
import { KeywordsPanel } from "@/components/keywords-panel";
import { ExportButtons } from "@/components/export-buttons";
import { getProject } from "@/lib/projects";
import { ProjectHubPage } from "@/components/project-hub-page";

export default async function SearchPerformanceHub({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <ProjectHubPage
      title="Search Performance"
      description="Search demand, rankings, SERP evidence, indexation, and first-party traffic integrations in one place."
      projectId={id}
      tools={[
        { href: "/keywords", title: "Keyword research", description: "Real keyword opportunities and content gaps. Volume is shown only when measured.", status: "measured" },
        { href: "/ranks", title: "Rank tracking", description: "Tracked rankings and movements for selected queries.", status: "measured" },
        { href: "/serp-capture", title: "SERP capture", description: "Stored search result evidence and competitor presence by query.", status: "measured" },
        { href: "/gsc", title: "Search Console", description: "First-party impressions/clicks when Google Search Console is connected.", status: "needs-setup" },
        { href: "/traffic", title: "Traffic intelligence", description: "Traffic and referral metrics from connected analytics sources.", status: "needs-setup" },
        { href: "/indexation", title: "Indexation", description: "Indexing status and crawl gaps that explain why pages cannot rank.", status: "measured" },
        { href: "/cannibalization", title: "Cannibalization", description: "Queries where multiple pages compete against each other.", status: "workflow" },
      ]}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Keyword intelligence</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Live keyword research, SERP difficulty, content gaps vs competitors, and backlink gap analysis.
          </p>
        </div>
        <ExportButtons projectId={id} types={["keywords", "content_gaps"]} />
      </div>
      <KeywordsPanel projectId={id} industry={project.industry || ""} />
    </ProjectHubPage>
  );
}
