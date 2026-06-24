import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DistributionPanel } from "@/components/distribution-panel";
import { LocalListingDraftsPanel } from "@/components/local-listing-drafts-panel";
import { DirectoryTracker } from "@/components/directory-tracker";
import { generateLocalListingDrafts } from "@/lib/engines/local-listings";
import { getProject } from "@/lib/projects";
import type { ContentAsset, CoverageItem } from "@/types/database";

const DIRECTORY_SURFACES = ["g2", "capterra", "trustpilot", "yelp", "directory", "review_site"];

export default async function DistributionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const [{ data: assets }, { data: brandProfile }, { data: coverage }] = await Promise.all([
    supabase
      .from("content_assets")
      .select("id, title, type, status, published_url")
      .eq("project_id", id)
      .order("updated_at", { ascending: false }),
    supabase.from("brand_profiles").select("*").eq("project_id", id).single(),
    supabase
      .from("coverage_items")
      .select("*")
      .eq("project_id", id)
      .in("surface", DIRECTORY_SURFACES)
      .order("platform_name"),
  ]);

  const localDrafts = generateLocalListingDrafts(project, brandProfile);
  const directoryItems = (coverage || []) as CoverageItem[];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Distribution & Publishing</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Publish to WordPress, Webflow, Shopify, local listings, and submit URLs for faster indexing.
        </p>
      </div>
      <LocalListingDraftsPanel drafts={localDrafts} />
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold mb-4">Directory Submission Tracker</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Track G2, Capterra, Trustpilot, Yelp, and other directory listing submissions.
        </p>
        <DirectoryTracker projectId={id} items={directoryItems} />
      </div>
      <DistributionPanel
        projectId={id}
        domain={project.domain}
        assets={(assets || []) as Array<Pick<ContentAsset, "id" | "title" | "type" | "status" | "published_url">>}
      />
    </div>
  );
}
