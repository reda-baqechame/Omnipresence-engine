import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import { searchYouTube, hasYouTubeCapability, type YouTubeVideo } from "@/lib/providers/youtube";

/**
 * Video SEO engine (Phase 6).
 *
 * 1. Video opportunities: keywords where YouTube/video already ranks on Google
 *    page-1 → "make a video" wins (video packs are a top-of-SERP feature).
 * 2. Competitor video gaps: keywords where competitors have YouTube coverage
 *    and the brand doesn't.
 * 3. VideoObject JSON-LD for a planned/published video.
 *
 * Keyless for opportunity detection (SERP router); competitor/channel coverage
 * uses the free YouTube Data API when a key is present.
 */

export interface VideoOpportunity {
  keyword: string;
  videoRanksOnGoogle: boolean;
  brandHasVideo: boolean;
  competitorHasVideo: boolean;
  topVideo?: { title: string; url: string; channel: string };
  score: number;
}

export interface VideoSeoResult {
  available: boolean;
  reason?: string;
  data_source: "measured" | "unavailable";
  opportunities: VideoOpportunity[];
  youtubeConnected: boolean;
  last_checked_at?: string;
}

function brandTokens(brand: string): string[] {
  return brand.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
}

export async function analyzeVideoSeo(input: {
  keywords: string[];
  brand: string;
  domain: string;
  competitors?: string[];
}): Promise<VideoSeoResult> {
  const keywords = [...new Set(input.keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 12);
  if (keywords.length === 0) {
    return { available: false, reason: "No keywords to analyze.", data_source: "unavailable", opportunities: [], youtubeConnected: false };
  }

  const ytConnected = hasYouTubeCapability();
  const bTokens = brandTokens(input.brand);
  const opportunities: VideoOpportunity[] = [];

  for (const keyword of keywords) {
    const serp = await searchGoogleOrganicRouter(keyword, "United States", input.domain, input.competitors || []);
    if (!serp.success || !serp.data) continue;

    const urls = serp.data.organicResults.map((r) => r.url.toLowerCase());
    const videoRanks = urls.some((u) => u.includes("youtube.com") || u.includes("youtu.be") || u.includes("vimeo.com"));

    // YouTube coverage (optional, when key present).
    let brandHasVideo = false;
    let competitorHasVideo = false;
    let topVideo: VideoOpportunity["topVideo"];
    if (ytConnected) {
      const yt = await searchYouTube(keyword, 10);
      if (yt.available) {
        const channels = yt.videos.map((v) => v.channelTitle.toLowerCase());
        brandHasVideo = channels.some((c) => bTokens.some((t) => c.includes(t)));
        competitorHasVideo = (input.competitors || []).some((comp) => {
          const ct = comp.toLowerCase().split(/\s+/)[0];
          return channels.some((c) => c.includes(ct));
        });
        const first: YouTubeVideo | undefined = yt.videos[0];
        if (first) topVideo = { title: first.title, url: first.url, channel: first.channelTitle };
      }
    }

    // Opportunity score: highest when video ranks on Google but brand has none.
    let score = 0;
    if (videoRanks) score += 60;
    if (!brandHasVideo) score += 25;
    if (competitorHasVideo) score += 15;

    if (videoRanks || competitorHasVideo) {
      opportunities.push({
        keyword,
        videoRanksOnGoogle: videoRanks,
        brandHasVideo,
        competitorHasVideo,
        topVideo,
        score: Math.min(100, score),
      });
    }
  }

  return {
    available: true,
    data_source: "measured",
    youtubeConnected: ytConnected,
    opportunities: opportunities.sort((a, b) => b.score - a.score),
    last_checked_at: new Date().toISOString(),
  };
}

/** Deterministic VideoObject JSON-LD for a planned/published video. */
export function buildVideoObjectSchema(input: {
  name: string;
  description: string;
  thumbnailUrl?: string;
  uploadDate?: string;
  contentUrl?: string;
  embedUrl?: string;
  durationISO?: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: input.name,
    description: input.description,
    thumbnailUrl: input.thumbnailUrl ? [input.thumbnailUrl] : undefined,
    uploadDate: input.uploadDate || new Date().toISOString().slice(0, 10),
    contentUrl: input.contentUrl,
    embedUrl: input.embedUrl,
    duration: input.durationISO,
  };
}
