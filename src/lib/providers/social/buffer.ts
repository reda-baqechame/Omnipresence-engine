export interface BufferPost {
  text: string;
  profileIds: string[];
  scheduledAt?: string;
  media?: { link?: string; picture?: string };
}

export interface BufferScheduleResult {
  success: boolean;
  updateId?: string;
  error?: string;
}

export async function scheduleViaBuffer(
  accessToken: string,
  post: BufferPost
): Promise<BufferScheduleResult> {
  if (!accessToken) {
    return { success: false, error: "Buffer access token not configured" };
  }

  try {
    const body: Record<string, unknown> = {
      text: post.text,
      profile_ids: post.profileIds,
    };
    if (post.scheduledAt) body.scheduled_at = post.scheduledAt;
    if (post.media) body.media = post.media;

    const response = await fetch("https://api.bufferapp.com/1/updates/create.json", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const err = await response.text();
      return { success: false, error: `Buffer error: ${response.status} ${err}` };
    }

    const data = (await response.json()) as { success?: boolean; updates?: Array<{ id: string }> };
    return {
      success: data.success !== false,
      updateId: data.updates?.[0]?.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Buffer request failed",
    };
  }
}
