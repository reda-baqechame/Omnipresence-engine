import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { PpcIntelPanel } from "@/components/ppc-intel-panel";

export const dynamic = "force-dynamic";

export default async function PpcPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  // Seed the savings calculator from REAL measured first-party sessions when available.
  const { data: metric } = await supabase
    .from("attribution_metrics")
    .select("organic_traffic, ai_referral_traffic")
    .eq("project_id", id)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">PPC Intelligence</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Replace paid search with proof: see who&apos;s bidding on your keywords and quantify the ad spend your organic
          + AI presence already replaces — priced with real Keyword Planner CPC when available.
        </p>
      </div>
      <PpcIntelPanel
        projectId={id}
        organicSessions={(metric?.organic_traffic as number) || 0}
        aiReferralSessions={(metric?.ai_referral_traffic as number) || 0}
      />
    </div>
  );
}
