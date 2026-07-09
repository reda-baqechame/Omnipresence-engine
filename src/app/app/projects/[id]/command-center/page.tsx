import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { loadSearchOpsCommandCenter } from "@/lib/engines/searchops-command-center";
import { SearchOpsCommandCenterView } from "@/components/searchops-command-center";
import { ScanPoller } from "@/components/scan-poller";

export default async function CommandCenterPage({
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
      <ScanPoller projectId={id} initialStatus={project.status} />
      <SearchOpsCommandCenterView data={data} />
    </div>
  );
}
