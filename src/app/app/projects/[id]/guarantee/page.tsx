import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { getLedgerForProject } from "@/lib/engines/results-ledger";
import { calculateVisibilityMetrics } from "@/lib/engines/visibility-scanner";
import { buildTwoTierGuarantee } from "@/lib/engines/guarantee";
import type { AeoLever } from "@/lib/engines/aeo-readiness";
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
  const [{ data: contract }, { data: claims }, ledger, { data: latestScore }, { data: visibility }, { data: readiness }] =
    await Promise.all([
      supabase.from("guarantee_contracts").select("*").eq("project_id", id).maybeSingle(),
      supabase.from("guarantee_claims").select("*").eq("project_id", id).order("created_at", { ascending: false }),
      getLedgerForProject(supabase, id, 30),
      supabase.from("scores").select("omnipresence_score").eq("project_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("visibility_results").select("brand_mentioned, brand_cited, competitor_mentions, raw_response").eq("project_id", id),
      supabase.from("aeo_readiness").select("levers").eq("project_id", id).maybeSingle(),
    ]);

  const visibilityMetrics = calculateVisibilityMetrics(visibility || []);
  const levers = (readiness?.levers as AeoLever[] | undefined) || [];
  const twoTier = buildTwoTierGuarantee(levers, "citation_rate");

  return (
    <GuaranteePanel
      projectId={id}
      contract={contract}
      claims={claims || []}
      ledger={ledger}
      latestMetrics={{
        omnipresence_score: latestScore?.omnipresence_score ?? 0,
        citation_rate: visibilityMetrics.citationRate,
        visibility_mention_rate: visibilityMetrics.mentionRate,
      }}
      twoTier={twoTier}
    />
  );
}
