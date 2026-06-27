export interface SocialPost {
  text: string;
  platforms: string[];
  scheduleDate?: string;
  mediaUrls?: string[];
}

export interface ScheduleResult {
  success: boolean;
  postId?: string;
  error?: string;
}

export async function scheduleViaAyrshare(
  apiKey: string,
  post: SocialPost
): Promise<ScheduleResult> {
  if (!apiKey) {
    return { success: false, error: "Ayrshare API key not configured" };
  }

  try {
    const response = await fetch("https://api.ayrshare.com/api/post", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        post: post.text,
        platforms: post.platforms,
        scheduleDate: post.scheduleDate,
        mediaUrls: post.mediaUrls,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const err = await response.text();
      return { success: false, error: `Ayrshare error: ${response.status} ${err}` };
    }

    const data = (await response.json()) as { id?: string; postIds?: Array<{ id: string }> };
    return { success: true, postId: data.id || data.postIds?.[0]?.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Ayrshare request failed",
    };
  }
}
