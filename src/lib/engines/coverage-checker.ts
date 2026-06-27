import type { CoverageItem, CoverageSurface, DataQuality } from "@/types/database";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";

interface PresenceResult {
  present: boolean;
  /** measured = definitive check; estimated = heuristic (e.g. HEAD probe); unavailable = could not verify. */
  quality: DataQuality;
  evidence?: string;
}

interface PlatformCheck {
  surface: CoverageSurface;
  platform_name: string;
  checkUrl: string;
}

const PLATFORMS: PlatformCheck[] = [
  { surface: "google_business", platform_name: "Google Business Profile", checkUrl: "https://www.google.com/maps/search/" },
  { surface: "bing_places", platform_name: "Bing Places", checkUrl: "https://www.bing.com/maps?q=" },
  { surface: "apple_business", platform_name: "Apple Business Connect", checkUrl: "https://maps.apple.com/?q=" },
  { surface: "linkedin", platform_name: "LinkedIn", checkUrl: "https://www.linkedin.com/company/" },
  { surface: "x_twitter", platform_name: "X (Twitter)", checkUrl: "https://x.com/" },
  { surface: "facebook", platform_name: "Facebook", checkUrl: "https://www.facebook.com/" },
  { surface: "instagram", platform_name: "Instagram", checkUrl: "https://www.instagram.com/" },
  { surface: "tiktok", platform_name: "TikTok", checkUrl: "https://www.tiktok.com/@" },
  { surface: "youtube", platform_name: "YouTube", checkUrl: "https://www.youtube.com/results?search_query=" },
  { surface: "reddit", platform_name: "Reddit", checkUrl: "https://www.reddit.com/search/?q=" },
  { surface: "quora", platform_name: "Quora", checkUrl: "https://www.quora.com/search?q=" },
  { surface: "g2", platform_name: "G2", checkUrl: "https://www.g2.com/search?query=" },
  { surface: "capterra", platform_name: "Capterra", checkUrl: "https://www.capterra.com/search/?search=" },
  { surface: "trustpilot", platform_name: "Trustpilot", checkUrl: "https://www.trustpilot.com/search?query=" },
  { surface: "yelp", platform_name: "Yelp", checkUrl: "https://www.yelp.com/search?find_desc=" },
];

export async function checkPlatformCoverage(
  projectId: string,
  brandName: string,
  domain: string,
  competitors: string[]
): Promise<Omit<CoverageItem, "id" | "created_at" | "updated_at">[]> {
  const items: Omit<CoverageItem, "id" | "created_at" | "updated_at">[] = [];
  const brandSlug = brandName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const domainName = domain.replace(/^www\./, "").split(".")[0];

  const now = new Date().toISOString();
  for (const platform of PLATFORMS) {
    const presence = await checkPresence(platform, brandName, brandSlug, domainName);
    const competitorPresent = await checkCompetitorPresence(platform, competitors);
    const unavailable = presence.quality === "unavailable";

    items.push({
      project_id: projectId,
      surface: platform.surface,
      platform_name: platform.platform_name,
      profile_url: presence.present ? `${platform.checkUrl}${encodeURIComponent(brandName)}` : undefined,
      is_present: presence.present,
      is_optimized: false,
      competitor_present: competitorPresent,
      measured: presence.quality === "measured",
      data_quality: presence.quality,
      data_source: presence.quality,
      confidence: presence.quality === "measured" ? 0.85 : presence.quality === "estimated" ? 0.4 : 0,
      last_checked_at: now,
      evidence_url: presence.evidence,
      notes: unavailable
        ? `Could not verify ${platform.platform_name} (provider blocked or unreachable) — not counted as missing`
        : presence.present
          ? undefined
          : `No detected presence on ${platform.platform_name}`,
    });
  }

  // Industry directories (generic check)
  const industryDirs = [
    { name: "Better Business Bureau", surface: "directory" as CoverageSurface },
    { name: "Chamber of Commerce", surface: "directory" as CoverageSurface },
    { name: "Industry-specific directory", surface: "directory" as CoverageSurface },
  ];

  for (const dir of industryDirs) {
    items.push({
      project_id: projectId,
      surface: dir.surface,
      platform_name: dir.name,
      is_present: false,
      is_optimized: false,
      competitor_present: false,
      measured: false,
      data_quality: "unavailable",
      data_source: "unavailable",
      confidence: 0,
      notes: "Manual verification recommended",
    });
  }

  return items;
}

async function checkPresence(
  platform: PlatformCheck,
  brandName: string,
  brandSlug: string,
  domainName: string
): Promise<PresenceResult> {
  // Maps / GBP: verify via SERP local pack when available (definitive).
  if (["google_business", "bing_places", "apple_business"].includes(platform.surface)) {
    try {
      const query = `${brandName} ${domainName}`;
      const serp = await searchGoogleOrganicRouter(query, "United States", domainName, []);
      if (serp.success && serp.data) {
        const inOrganic = serp.data.brandInResults;
        const local = serp.data.organicResults.find(
          (r) =>
            r.url.includes("google.com/maps") ||
            r.url.includes("g.page") ||
            r.title.toLowerCase().includes(brandName.toLowerCase())
        );
        return { present: Boolean(inOrganic || local), quality: "measured", evidence: local?.url };
      }
    } catch {
      // SERP provider unreachable — honestly unavailable, not "missing".
    }
    return { present: false, quality: "unavailable" };
  }

  // Social platforms: HEAD probe of common URL patterns. This is a heuristic
  // (handles/usernames rarely match the brand slug exactly), so it is labeled
  // "estimated" rather than a definitive measurement.
  const socialPlatforms = ["linkedin", "x_twitter", "facebook", "instagram", "tiktok"];
  if (socialPlatforms.includes(platform.surface)) {
    const urls = [`${platform.checkUrl}${brandSlug}`, `${platform.checkUrl}${domainName}`];
    let anyReachable = false;
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          method: "HEAD",
          signal: AbortSignal.timeout(5000),
          redirect: "follow",
        });
        anyReachable = true;
        if (response.ok || response.status === 200) {
          return { present: true, quality: "estimated", evidence: url };
        }
      } catch {
        // network error for this URL — try the next pattern
      }
    }
    return anyReachable
      ? { present: false, quality: "estimated" }
      : { present: false, quality: "unavailable" };
  }

  // Review/directory platforms: search-based content check (definitive on success).
  if (["g2", "capterra", "trustpilot", "yelp"].includes(platform.surface)) {
    try {
      const searchUrl = `${platform.checkUrl}${encodeURIComponent(brandName)}`;
      const response = await fetch(searchUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "PresenceOS-Audit/1.0" },
      });
      if (response.ok) {
        const text = (await response.text()).toLowerCase();
        const present =
          text.includes(brandName.toLowerCase()) || text.includes(domainName.toLowerCase());
        return { present, quality: "measured", evidence: present ? searchUrl : undefined };
      }
      return { present: false, quality: "unavailable" };
    } catch {
      return { present: false, quality: "unavailable" };
    }
  }

  return { present: false, quality: "unavailable" };
}

async function checkCompetitorPresence(
  platform: PlatformCheck,
  competitors: string[]
): Promise<boolean> {
  if (competitors.length === 0) return false;

  for (const comp of competitors.slice(0, 2)) {
    try {
      const searchUrl = `${platform.checkUrl}${encodeURIComponent(comp)}`;
      const response = await fetch(searchUrl, {
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "PresenceOS-Audit/1.0" },
      });
      if (response.ok) {
        const text = await response.text();
        if (text.toLowerCase().includes(comp.toLowerCase())) return true;
      }
    } catch {
      // Continue
    }
  }

  return false;
}

export function getCoverageGaps(items: CoverageItem[]): CoverageItem[] {
  return items.filter((item) => !item.is_present || item.competitor_present);
}
