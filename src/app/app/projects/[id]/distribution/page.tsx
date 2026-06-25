import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DistributionPanel } from "@/components/distribution-panel";
import { DistributionBoard } from "@/components/distribution-board";
import { IndexingPanel } from "@/components/indexing-panel";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { LocalListingDraftsPanel } from "@/components/local-listing-drafts-panel";
import { DirectoryTracker } from "@/components/directory-tracker";
import { generateLocalListingDrafts, verifyLocalPresence } from "@/lib/engines/local-listings";
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
  const localPresence = await verifyLocalPresence(project);
  const directoryItems = (coverage || []) as CoverageItem[];

  const presenceStyles: Record<string, string> = {
    verified: "text-green-600 border-green-600/30 bg-green-600/10",
    not_found: "text-red-600 border-red-600/30 bg-red-600/10",
    manual: "text-amber-600 border-amber-600/30 bg-amber-600/10",
    unknown: "text-muted-foreground border-border bg-muted/30",
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Distribution & Publishing</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Publish to WordPress, Webflow, Shopify, local listings, and submit URLs for faster indexing.
        </p>
      </div>
      <IntegrationsPanel projectId={id} />
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold mb-1">Local Presence Verification</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Real check of whether your business is actually discoverable on local map surfaces that AI assistants pull from.
        </p>
        <ul className="space-y-2">
          {localPresence.map((p) => (
            <li
              key={p.platform}
              className="flex items-start justify-between gap-4 rounded-lg border border-border p-3"
            >
              <div>
                <p className="text-sm font-medium capitalize">
                  {p.platform.replace(/_/g, " ")}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{p.detail}</p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${
                  presenceStyles[p.status] || presenceStyles.unknown
                }`}
              >
                {p.status.replace(/_/g, " ")}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <LocalListingDraftsPanel drafts={localDrafts} />
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold mb-4">Directory Submission Tracker</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Track G2, Capterra, Trustpilot, Yelp, and other directory listing submissions.
        </p>
        <DirectoryTracker projectId={id} items={directoryItems} />
      </div>
      <DistributionBoard assets={(assets || []) as Array<Pick<ContentAsset, "id" | "title" | "type" | "status" | "published_url">>} />
      <IndexingPanel projectId={id} domain={project.domain} />
      <DistributionPanel
        projectId={id}
        domain={project.domain}
        assets={(assets || []) as Array<Pick<ContentAsset, "id" | "title" | "type" | "status" | "published_url">>}
      />
    </div>
  );
}
