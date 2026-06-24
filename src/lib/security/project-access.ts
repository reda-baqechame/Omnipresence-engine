import type { SupabaseClient } from "@supabase/supabase-js";
import type { MembershipRole } from "@/types/database";

const ROLE_RANK: Record<MembershipRole, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export interface ProjectAccess {
  projectId: string;
  organizationId: string;
  role: MembershipRole;
}

export async function verifyProjectAccess(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
  minRole: MembershipRole = "viewer"
): Promise<ProjectAccess | null> {
  const { data: project } = await supabase
    .from("projects")
    .select("id, organization_id")
    .eq("id", projectId)
    .single();

  if (!project) return null;

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", project.organization_id)
    .single();

  if (!membership) return null;
  if (ROLE_RANK[membership.role as MembershipRole] < ROLE_RANK[minRole]) return null;

  return {
    projectId: project.id,
    organizationId: project.organization_id,
    role: membership.role as MembershipRole,
  };
}
