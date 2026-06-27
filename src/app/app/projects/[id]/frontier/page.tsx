import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { FrontierPanel } from "@/components/frontier-panel";

export default async function FrontierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const { data: prompts } = await supabase
    .from("prompts")
    .select("text")
    .eq("project_id", id)
    .limit(50);

  const promptTexts = Array.from(
    new Set((prompts || []).map((p) => p.text as string).filter(Boolean))
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Frontier Levers</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Where GEO collapses into SEO: intercept AI fan-out sub-queries, find the third-party
          sources AI cites for competitors but not you, and draft scoped earned-media plays.
        </p>
      </div>
      <FrontierPanel projectId={id} prompts={promptTexts} />
    </div>
  );
}
