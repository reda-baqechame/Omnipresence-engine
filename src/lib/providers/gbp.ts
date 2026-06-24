/**
 * Google Business Profile — local posts via Business Profile API
 */

export interface GBPPostInput {
  summary: string;
  topicType?: "STANDARD" | "EVENT" | "OFFER";
  callToAction?: { actionType: string; url: string };
}

export async function createGBPLocalPost(
  accessToken: string,
  accountId: string,
  locationId: string,
  post: GBPPostInput
): Promise<{ success: boolean; postName?: string; error?: string }> {
  try {
    const parent = `accounts/${accountId}/locations/${locationId}`;
    const response = await fetch(
      `https://mybusiness.googleapis.com/v4/${parent}/localPosts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          languageCode: "en-US",
          summary: post.summary.slice(0, 1500),
          topicType: post.topicType || "STANDARD",
          callToAction: post.callToAction,
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return { success: false, error: err.slice(0, 200) };
    }

    const data = await response.json() as { name?: string };
    return { success: true, postName: data.name };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "GBP post failed",
    };
  }
}
