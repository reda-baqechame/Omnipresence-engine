/**
 * Direct social posting adapters (Phase 23 / manifest v24, Wave K).
 *
 * Posts straight to the platform APIs (X, LinkedIn) using your own OAuth
 * tokens — no Buffer/Ayrshare middleman or per-post fees. Each adapter is
 * env-gated and degrades to a structured error when not configured; nothing is
 * ever faked. Buffer/Ayrshare remain available as optional managed adapters.
 */

export type DirectSocialPlatform = "x" | "linkedin";

export interface DirectPostResult {
  success: boolean;
  platform: DirectSocialPlatform;
  postId?: string;
  error?: string;
}

function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() && !v.startsWith("your-") ? v.trim() : undefined;
}

export function hasXCapability(): boolean {
  // OAuth2 user-context access token with tweet.write scope.
  return Boolean(env("X_ACCESS_TOKEN"));
}

export function hasLinkedInCapability(): boolean {
  return Boolean(env("LINKEDIN_ACCESS_TOKEN") && env("LINKEDIN_AUTHOR_URN"));
}

export function hasDirectSocialCapability(): boolean {
  return hasXCapability() || hasLinkedInCapability();
}

export function directSocialPlatforms(): DirectSocialPlatform[] {
  const out: DirectSocialPlatform[] = [];
  if (hasXCapability()) out.push("x");
  if (hasLinkedInCapability()) out.push("linkedin");
  return out;
}

async function postToX(text: string): Promise<DirectPostResult> {
  const token = env("X_ACCESS_TOKEN");
  if (!token) return { success: false, platform: "x", error: "X_ACCESS_TOKEN not configured" };
  try {
    const res = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, platform: "x", error: `X error ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as { data?: { id?: string } };
    return { success: true, platform: "x", postId: data.data?.id };
  } catch (error) {
    return { success: false, platform: "x", error: error instanceof Error ? error.message : "X request failed" };
  }
}

async function postToLinkedIn(text: string): Promise<DirectPostResult> {
  const token = env("LINKEDIN_ACCESS_TOKEN");
  const author = env("LINKEDIN_AUTHOR_URN");
  if (!token || !author) {
    return { success: false, platform: "linkedin", error: "LINKEDIN_ACCESS_TOKEN/AUTHOR_URN not configured" };
  }
  try {
    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text },
            shareMediaCategory: "NONE",
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, platform: "linkedin", error: `LinkedIn error ${res.status}: ${body.slice(0, 200)}` };
    }
    const id = res.headers.get("x-restli-id") || undefined;
    return { success: true, platform: "linkedin", postId: id };
  } catch (error) {
    return { success: false, platform: "linkedin", error: error instanceof Error ? error.message : "LinkedIn request failed" };
  }
}

/** Post the same text directly to one platform via its native API. */
export async function postDirectSocial(platform: DirectSocialPlatform, text: string): Promise<DirectPostResult> {
  return platform === "x" ? postToX(text) : postToLinkedIn(text);
}

/** Post to every configured direct platform; returns one result per platform. */
export async function broadcastDirectSocial(text: string): Promise<DirectPostResult[]> {
  const platforms = directSocialPlatforms();
  return Promise.all(platforms.map((p) => postDirectSocial(p, text)));
}
