import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { CommunityMentionsPanel } from "@/components/community-mentions-panel";

export default async function CommunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Social & Community</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Track Reddit, Quora, and community mentions. Import mention CSVs and monitor brand vs competitor coverage.
        </p>
      </div>
      <CommunityMentionsPanel projectId={id} />
    </div>
  );
}
