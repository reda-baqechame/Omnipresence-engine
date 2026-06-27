import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ContentBoard } from "@/components/content-board";
import { BlogPipelinePanel } from "@/components/blog-pipeline-panel";
import { ContentOptimizerPanel } from "@/components/content-optimizer-panel";
import { VideoSeoPanel } from "@/components/video-seo-panel";
import { getProject } from "@/lib/projects";

export default async function ContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const { data: contentAssets } = await supabase
    .from("content_assets")
    .select("id, title, type, status, metadata")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Content Factory</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Generate brand-aware content assets. All community drafts require human review before publishing.
        </p>
      </div>
      <ContentOptimizerPanel projectId={id} />
      <VideoSeoPanel projectId={id} />
      <BlogPipelinePanel assets={contentAssets || []} />
      <ContentBoard projectId={id} assets={contentAssets || []} />
    </div>
  );
}
