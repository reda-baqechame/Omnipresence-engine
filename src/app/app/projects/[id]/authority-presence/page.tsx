import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthorityCRM } from "@/components/authority-crm";
import type { AuthorityOpportunity } from "@/types/database";
import { getProject } from "@/lib/projects";
import { ProjectHubPage } from "@/components/project-hub-page";

export default async function AuthorityPresenceHub({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const { data: authority } = await supabase
    .from("authority_opportunities")
    .select("*")
    .eq("project_id", id)
    .order("estimated_impact", { ascending: false });

  const opportunities = (authority || []) as AuthorityOpportunity[];

  return (
    <ProjectHubPage
      title="Authority & Presence"
      description="External proof: backlinks, citations, directories, local presence, reputation, community, and market trends."
      projectId={id}
      tools={[
        { href: "/authority", title: "Authority opportunities", description: "Measured competitor backlink/listicle/source gaps and outreach CRM.", status: "measured" },
        { href: "/backlinks", title: "Backlinks", description: "Backlink snapshots and authority signals from connected/open providers.", status: "measured" },
        { href: "/coverage", title: "Directory coverage", description: "Verified platform presence from live brand search results.", status: "measured" },
        { href: "/local", title: "Local SEO", description: "Local and Google Business Profile readiness when data is available.", status: "needs-setup" },
        { href: "/reputation", title: "Reputation", description: "Brand/news/community mentions with sentiment and source URLs.", status: "measured" },
        { href: "/community", title: "Social and community", description: "Community mentions and answer opportunities backed by live sources.", status: "measured" },
        { href: "/trends", title: "Trends", description: "Market and topic trend signals used to prioritize action.", status: "measured" },
        { href: "/merchant", title: "Merchant visibility", description: "Shopping/product visibility for brands with merchant/product feeds.", status: "needs-setup" },
      ]}
    >
      <div>
        <h3 className="text-lg font-semibold">Top authority opportunities</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Measured competitor gaps — backlinks, listicles, podcasts, directories. Volume and impact are shown only when measured.
        </p>
      </div>
      {opportunities.length > 0 ? (
        <AuthorityCRM projectId={id} opportunities={opportunities.slice(0, 12)} />
      ) : (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
          No authority opportunities yet. Run a scan to discover measured outreach targets from competitor gaps.
        </div>
      )}
    </ProjectHubPage>
  );
}
