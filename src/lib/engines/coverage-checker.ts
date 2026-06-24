import type { CoverageItem, CoverageSurface } from "@/types/database";

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

  for (const platform of PLATFORMS) {
    const isPresent = await checkPresence(platform, brandName, brandSlug, domainName);
    const competitorPresent = await checkCompetitorPresence(platform, competitors);

    items.push({
      project_id: projectId,
      surface: platform.surface,
      platform_name: platform.platform_name,
      profile_url: isPresent ? `${platform.checkUrl}${encodeURIComponent(brandName)}` : undefined,
      is_present: isPresent,
      is_optimized: false,
      competitor_present: competitorPresent,
      notes: isPresent ? undefined : `No detected presence on ${platform.platform_name}`,
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
): Promise<boolean> {
  // Social platforms: try common URL patterns
  const socialPlatforms = ["linkedin", "x_twitter", "facebook", "instagram", "tiktok"];
  if (socialPlatforms.includes(platform.surface)) {
    const urls = [
      `${platform.checkUrl}${brandSlug}`,
      `${platform.checkUrl}${domainName}`,
    ];

    for (const url of urls) {
      try {
        const response = await fetch(url, {
          method: "HEAD",
          signal: AbortSignal.timeout(5000),
          redirect: "follow",
        });
        if (response.ok || response.status === 200) return true;
      } catch {
        // Continue
      }
    }
  }

  // For review/directory platforms, use search-based heuristic
  if (["g2", "capterra", "trustpilot", "yelp"].includes(platform.surface)) {
    try {
      const searchUrl = `${platform.checkUrl}${encodeURIComponent(brandName)}`;
      const response = await fetch(searchUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "PresenceOS-Audit/1.0" },
      });
      if (response.ok) {
        const text = await response.text();
        return text.toLowerCase().includes(brandName.toLowerCase()) ||
          text.toLowerCase().includes(domainName.toLowerCase());
      }
    } catch {
      // Unable to verify
    }
  }

  return false;
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
