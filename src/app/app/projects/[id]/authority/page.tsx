import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthorityCRM } from "@/components/authority-crm";
import { CommunityMentionsPanel } from "@/components/community-mentions-panel";
import type { AuthorityOpportunity } from "@/types/database";
import { getProject } from "@/lib/projects";

export default async function AuthorityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const { data: authority } = await supabase
    .from("authority_opportunities")
    .select("*")
    .eq("project_id", id)
    .order("estimated_impact", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Authority & Outreach CRM</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Competitor gap opportunities — backlinks, listicles, podcasts, directories. Generate pitches with human approval.
        </p>
      </div>
      <AuthorityCRM projectId={id} opportunities={(authority || []) as AuthorityOpportunity[]} />
      <CommunityMentionsPanel projectId={id} />
    </div>
  );
}
