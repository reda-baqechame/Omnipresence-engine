import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AttributionPanel } from "@/components/attribution-panel";
import type { AttributionMetric } from "@/types/database";
import { getProject } from "@/lib/projects";

export default async function AttributionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();

  const [{ data: attribution }, { data: connections }] = await Promise.all([
    supabase
      .from("attribution_metrics")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(2),
    supabase.from("oauth_connections").select("provider, metadata").eq("project_id", id),
  ]);

  const ga4Conn = connections?.find((c) => c.provider === "google_analytics");
  const plausibleConn = connections?.find((c) => c.provider === "plausible");

  return (
    <AttributionPanel
      projectId={id}
      domain={project.domain}
      industry={project.industry}
      monthlyAdSpend={project.monthly_ad_spend}
      metrics={(attribution || []) as AttributionMetric[]}
      hasGscConnection={connections?.some((c) => c.provider === "google_search_console") || false}
      hasBingConnection={connections?.some((c) => c.provider === "bing_webmaster") || false}
      hasGa4Connection={!!ga4Conn}
      hasPlausibleConnection={!!plausibleConn}
      ga4PropertyId={(ga4Conn?.metadata as { property_id?: string } | null)?.property_id}
      plausibleSiteId={(plausibleConn?.metadata as { site_id?: string } | null)?.site_id}
    />
  );
}
