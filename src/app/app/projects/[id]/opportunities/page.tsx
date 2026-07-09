import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { loadSearchOpsCommandCenter } from "@/lib/engines/searchops-command-center";
import { OpportunitiesPanel } from "@/components/opportunities-panel";

export default async function OpportunitiesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const data = await loadSearchOpsCommandCenter(supabase, project);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">SearchOps</p>
        <h1 className="text-2xl font-semibold">Evidence-backed opportunities</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Every item includes evidence, confidence, and a verification plan. Unavailable signals never
          become fake zeros.
        </p>
        <Link
          href={`/app/projects/${id}/command-center`}
          className="text-sm text-primary hover:underline inline-block"
        >
          ← Command Center
        </Link>
      </header>
      <OpportunitiesPanel projectId={id} opportunities={data.opportunities} />
    </div>
  );
}
