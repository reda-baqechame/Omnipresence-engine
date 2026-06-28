import type { CoverageItem, CoverageSurface } from "@/types/database";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";

interface PlatformCheck {
  surface: CoverageSurface;
  platform_name: string;
  /** Registrable domains that identify a real profile on this platform. */
  domains: string[];
}

// Coverage is verified against REAL Google organic results for the brand's
// ecosystem — not soft-404-prone HEAD probes or search-page echoes (which
// produce false "present" signals). A profile that surfaces in the brand's own
// SERP is a definitive, defensible presence signal; absence there is a genuine
// visibility gap worth flagging.
const PLATFORMS: PlatformCheck[] = [
  { surface: "linkedin", platform_name: "LinkedIn", domains: ["linkedin.com"] },
  { surface: "x_twitter", platform_name: "X (Twitter)", domains: ["x.com", "twitter.com"] },
  { surface: "facebook", platform_name: "Facebook", domains: ["facebook.com", "fb.com"] },
  { surface: "instagram", platform_name: "Instagram", domains: ["instagram.com"] },
  { surface: "tiktok", platform_name: "TikTok", domains: ["tiktok.com"] },
  { surface: "youtube", platform_name: "YouTube", domains: ["youtube.com"] },
  { surface: "reddit", platform_name: "Reddit", domains: ["reddit.com"] },
  { surface: "quora", platform_name: "Quora", domains: ["quora.com"] },
  { surface: "g2", platform_name: "G2", domains: ["g2.com"] },
  { surface: "capterra", platform_name: "Capterra", domains: ["capterra.com"] },
  { surface: "trustpilot", platform_name: "Trustpilot", domains: ["trustpilot.com"] },
  { surface: "yelp", platform_name: "Yelp", domains: ["yelp.com"] },
  { surface: "google_business", platform_name: "Google Business Profile", domains: ["g.page", "business.google.com"] },
];

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function hostMatches(host: string, domains: string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

export async function checkPlatformCoverage(
  projectId: string,
  brandName: string,
  domain: string,
  competitors: string[]
): Promise<Omit<CoverageItem, "id" | "created_at" | "updated_at">[]> {
  const items: Omit<CoverageItem, "id" | "created_at" | "updated_at">[] = [];
  const now = new Date().toISOString();

  // One real SERP query for the brand's ecosystem (brand + domain disambiguates
  // generic names). Reused to verify every platform — accurate and cost-bounded.
  let brandResults: Array<{ url: string; title: string }> = [];
  let serpOk = false;
  try {
    const serp = await searchGoogleOrganicRouter(`${brandName} ${domain}`, "United States", domain, competitors);
    if (serp.success && serp.data) {
      brandResults = serp.data.organicResults;
      serpOk = true;
    }
  } catch {
    // SERP provider unreachable — every row is honestly "unavailable" below.
  }

  // One query for the top competitor's ecosystem → real competitive coverage.
  let competitorResults: Array<{ url: string; title: string }> = [];
  if (competitors[0]) {
    try {
      const cs = await searchGoogleOrganicRouter(`${competitors[0]}`, "United States", "", []);
      if (cs.success && cs.data) competitorResults = cs.data.organicResults;
    } catch {
      // best-effort
    }
  }

  const brandHosts = brandResults.map((r) => ({ host: hostnameOf(r.url), url: r.url })).filter((h) => h.host);
  const competitorHosts = competitorResults.map((r) => hostnameOf(r.url)).filter(Boolean);

  for (const platform of PLATFORMS) {
    const hit = brandHosts.find((h) => hostMatches(h.host, platform.domains));
    const present = serpOk && Boolean(hit);
    const competitorPresent = competitorHosts.some((h) => hostMatches(h, platform.domains));

    items.push({
      project_id: projectId,
      surface: platform.surface,
      platform_name: platform.platform_name,
      profile_url: hit?.url,
      is_present: present,
      is_optimized: false,
      competitor_present: competitorPresent,
      measured: serpOk,
      data_quality: serpOk ? "measured" : "unavailable",
      data_source: serpOk ? "measured" : "unavailable",
      confidence: serpOk ? (present ? 0.85 : 0.6) : 0,
      last_checked_at: now,
      evidence_url: hit?.url,
      notes: !serpOk
        ? "Could not verify — SERP provider unavailable (not counted as missing)"
        : present
          ? undefined
          : `No ${platform.platform_name} profile surfaced in brand search — visibility gap`,
    });
  }

  return items;
}

export function getCoverageGaps(items: CoverageItem[]): CoverageItem[] {
  return items.filter((item) => !item.is_present || item.competitor_present);
}
