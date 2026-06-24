import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentAssetType } from "@/types/database";
import { FREE_ACCESS_MODE } from "@/lib/config/access";
import { ANTI_SPAM_RULES } from "@/lib/engines/content-generator";

const BLOG_TYPES = new Set<ContentAssetType>(["blog_post", "blog_brief"]);
const MAX_BLOG_POSTS_PER_WEEK = 4;

export function getAntiSpamRules(): string[] {
  return ANTI_SPAM_RULES;
}

export async function assertContentGenerationAllowed(
  supabase: SupabaseClient,
  projectId: string,
  type: ContentAssetType
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (FREE_ACCESS_MODE) return { allowed: true };

  if (!BLOG_TYPES.has(type)) {
    return { allowed: true };
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { count } = await supabase
    .from("content_assets")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .in("type", ["blog_post", "blog_brief"])
    .gte("created_at", weekAgo);

  if ((count || 0) >= MAX_BLOG_POSTS_PER_WEEK) {
    return {
      allowed: false,
      reason: `Anti-spam limit: max ${MAX_BLOG_POSTS_PER_WEEK} blog assets per week per project`,
    };
  }

  return { allowed: true };
}
