import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { snapshotProjectBacklinkGraph } from "@/lib/engines/backlink-monitor";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { ProjectMutationSchema } from "@/lib/validation/schemas";

interface TopLink {
  source_url?: string;
  source_domain?: string;
  anchor?: string;
  nofollow?: boolean;
  domain_rank?: number | null;
  spam_risk?: number;
  link_value?: number;
  first_seen?: string;
  last_seen?: string;
}

interface IntersectionRow {
  source_domain?: string;
  links_to?: string[];
  count?: number;
  authority?: number;
  brand_gap?: boolean;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  // Velocity: most-recent first, then reversed for charting oldest→newest.
  const { data: snaps } = await supabase
    .from("backlink_graph_snapshots")
    .select(
      "total_links, referring_domains, new_count, lost_count, toxic_count, nofollow_count, data_source, top_links, intersection, created_at"
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(26);

  if (!snaps || snaps.length === 0) {
    return NextResponse.json({ available: false, reason: "No backlink graph snapshots yet. Run a graph refresh." });
  }

  const latest = snaps[0];
  const topLinks = (latest.top_links as TopLink[] | null) || [];
  const intersection = (latest.intersection as IntersectionRow[] | null) || [];

  // rel (dofollow vs nofollow) breakdown from the live link rows.
  const nofollow = topLinks.filter((l) => l.nofollow).length;
  const dofollow = topLinks.length - nofollow;

  // Anchor-text distribution (top 15), so anchor over-optimization is visible.
  const anchorCounts = new Map<string, number>();
  for (const l of topLinks) {
    const a = (l.anchor || "").trim().toLowerCase() || "(empty)";
    anchorCounts.set(a, (anchorCounts.get(a) || 0) + 1);
  }
  const anchors = [...anchorCounts.entries()]
    .map(([anchor, count]) => ({ anchor, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const velocity = [...snaps]
    .reverse()
    .map((s) => ({
      date: s.created_at,
      total: s.total_links ?? 0,
      referringDomains: s.referring_domains ?? 0,
      new: s.new_count ?? 0,
      lost: s.lost_count ?? 0,
    }));

  return NextResponse.json({
    available: true,
    latest: {
      totalLinks: latest.total_links ?? 0,
      referringDomains: latest.referring_domains ?? 0,
      newCount: latest.new_count ?? 0,
      lostCount: latest.lost_count ?? 0,
      toxicCount: latest.toxic_count ?? 0,
      nofollowCount: latest.nofollow_count ?? 0,
      dataSource: latest.data_source ?? "unavailable",
      createdAt: latest.created_at,
    },
    rel: { dofollow, nofollow },
    anchors,
    topLinks: topLinks.slice(0, 50),
    intersection: intersection.slice(0, 50),
    velocity,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const v = await validateBody(request, ProjectMutationSchema);
  if (v.response) return v.response;
  const { projectId } = v.data;

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("domain, competitors")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const result = await snapshotProjectBacklinkGraph(
    supabase,
    projectId,
    project.domain,
    (project.competitors || []) as string[]
  );
  return NextResponse.json(result);
}
