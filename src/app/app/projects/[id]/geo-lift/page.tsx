import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { getLedgerForProject } from "@/lib/engines/results-ledger";
import { GeoLiftLab } from "@/components/geo-lift-lab";

export default async function GeoLiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const entries = await getLedgerForProject(supabase, id, 100);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">GEO Lift Lab</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          The closed loop from measurement to proof: rewrite a page for AI answers, wait for re-crawl, then measure the
          real citation lift. Every result is a before/after delta from your own probe history.
        </p>
      </div>
      <GeoLiftLab projectId={id} initialEntries={entries} />
    </div>
  );
}
