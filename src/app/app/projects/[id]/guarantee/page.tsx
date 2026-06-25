import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { getLedgerForProject } from "@/lib/engines/results-ledger";
import { GuaranteePanel } from "@/components/guarantee-panel";

export default async function GuaranteePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const [{ data: contract }, { data: claims }, ledger] = await Promise.all([
    supabase.from("guarantee_contracts").select("*").eq("project_id", id).maybeSingle(),
    supabase.from("guarantee_claims").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    getLedgerForProject(supabase, id, 30),
  ]);

  return (
    <GuaranteePanel
      projectId={id}
      contract={contract}
      claims={claims || []}
      ledger={ledger}
    />
  );
}
