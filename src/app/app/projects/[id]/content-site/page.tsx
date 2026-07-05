import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { FindingCard } from "@/components/finding-card";
import { getProject } from "@/lib/projects";
import { ProjectHubPage } from "@/components/project-hub-page";

export default async function ContentSiteHub({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const { data: findings } = await supabase
    .from("technical_findings")
    .select("*")
    .eq("project_id", id)
    .order("severity")
    .limit(40);

  const critical =
    findings?.filter((f) => f.severity === "critical" || f.severity === "high").slice(0, 8) || [];

  return (
    <ProjectHubPage
      title="Content & Site"
      description="Technical crawl health, entity clarity, content gaps, internal linking, and pages to build."
      projectId={id}
      tools={[
        { href: "/technical", title: "Technical audit", description: "Measured robots, sitemap, crawlability, schema, performance, and passage-readiness findings.", status: "measured" },
        { href: "/entity", title: "Entity profile", description: "Brand/entity signals that help AI and search systems disambiguate the business.", status: "measured" },
        { href: "/content", title: "Content audit", description: "Content opportunities and gaps derived from measured prompts and search demand.", status: "workflow" },
        { href: "/topical", title: "Topical map", description: "Topic clusters organized around buyer intent and authority coverage.", status: "workflow" },
        { href: "/pseo", title: "Programmatic pages", description: "Page opportunities that can scale only when backed by real query evidence.", status: "workflow" },
        { href: "/internal-links", title: "Internal links", description: "Internal linking opportunities and crawl-path improvements.", status: "measured" },
      ]}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Critical technical issues</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Highest-severity crawl and site health findings from the latest measured audit.
          </p>
        </div>
        <Link href={`/app/projects/${id}/technical`} className="text-sm text-primary hover:underline shrink-0">
          Full technical audit →
        </Link>
      </div>

      {critical.length > 0 ? (
        <div className="space-y-3">
          {critical.map((f) => (
            <FindingCard
              key={f.id}
              title={f.title}
              description={f.description}
              severity={f.severity}
              fix={f.fix_recommendation}
              category={f.category}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          No critical technical issues recorded. Run a scan to populate site health findings.
        </div>
      )}
    </ProjectHubPage>
  );
}
