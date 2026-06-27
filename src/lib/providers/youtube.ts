import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";

/**
 * YouTube Data API v3 — free quota (10k units/day). Used for video-SEO:
 * discovering where video ranks, competitor channel/video gaps, and the search
 * volume of video intent. Needs a free YOUTUBE_API_KEY; degrades to
 * `available:false` when unset (never fabricated data).
 */

const YT_BASE = "https://www.googleapis.com/youtube/v3";

export interface YouTubeVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  publishedAt?: string;
  url: string;
}

export function hasYouTubeCapability(): boolean {
  const k = process.env.YOUTUBE_API_KEY;
  return Boolean(k && k.trim() && !k.startsWith("your-"));
}

export async function searchYouTube(
  query: string,
  maxResults = 10
): Promise<{ available: boolean; reason?: string; videos: YouTubeVideo[] }> {
  if (!hasYouTubeCapability()) {
    return { available: false, reason: "YOUTUBE_API_KEY not set (free key).", videos: [] };
  }
  const params = new URLSearchParams({
    part: "snippet",
    q: query,
    type: "video",
    maxResults: String(Math.min(25, maxResults)),
    key: process.env.YOUTUBE_API_KEY!,
  });
  try {
    const res = await fetchWithTimeout(`${YT_BASE}/search?${params}`, { timeoutMs: 15_000 });
    if (!res.ok) {
      return { available: false, reason: `YouTube API ${res.status}`, videos: [] };
    }
    const data = (await res.json()) as {
      items?: Array<{
        id?: { videoId?: string };
        snippet?: { title?: string; channelTitle?: string; channelId?: string; publishedAt?: string };
      }>;
    };
    const videos: YouTubeVideo[] = (data.items || [])
      .filter((i) => i.id?.videoId)
      .map((i) => ({
        videoId: i.id!.videoId!,
        title: i.snippet?.title || "",
        channelTitle: i.snippet?.channelTitle || "",
        channelId: i.snippet?.channelId || "",
        publishedAt: i.snippet?.publishedAt,
        url: `https://www.youtube.com/watch?v=${i.id!.videoId}`,
      }));
    return { available: true, videos };
  } catch (error) {
    logProviderError("youtube", error, { query });
    return { available: false, reason: error instanceof Error ? error.message : "YouTube failed", videos: [] };
  }
}
