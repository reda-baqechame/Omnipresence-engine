import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PromptCampaignPanel } from "@/components/prompt-campaign-panel";
import { getProject } from "@/lib/projects";

export default async function PromptsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const { data: connections } = await supabase
    .from("oauth_connections")
    .select("provider")
    .eq("project_id", id);

  const { data: prompts } = await supabase
    .from("prompts")
    .select("id, text, category, priority, is_tracked")
    .eq("project_id", id)
    .order("priority", { ascending: false });

  return (
    <PromptCampaignPanel
      projectId={id}
      hasGscConnection={connections?.some((c) => c.provider === "google_search_console") || false}
      initialPrompts={prompts || []}
    />
  );
}
