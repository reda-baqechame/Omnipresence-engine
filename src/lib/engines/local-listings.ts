import type { Project, BrandProfile } from "@/types/database";

export interface LocalListingDraft {
  platform: "google_business" | "bing_places" | "apple_business";
  title: string;
  description: string;
  highlights: string[];
}

export interface LocalPresenceStatus {
  platform: "google_business" | "bing_places" | "apple_business";
  status: "verified" | "not_found" | "manual" | "unknown";
  detail: string;
  matched?: { title: string; rating?: number; reviews?: number; address?: string };
}

interface SerperPlace {
  title?: string;
  address?: string;
  rating?: number;
  ratingCount?: number;
  website?: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Verify REAL local presence. Google Business Profile is confirmed via Serper
 * Places (the business actually appears on the map). Bing Places and Apple
 * Business Connect have no public lookup API, so they are reported as manual
 * verification items rather than faked.
 */
export async function verifyLocalPresence(
  project: Pick<Project, "name" | "domain" | "location">
): Promise<LocalPresenceStatus[]> {
  const out: LocalPresenceStatus[] = [];
  const serperKey = process.env.SERPER_API_KEY;
  const location = project.location || "United States";
  const brandNorm = normalize(project.name);
  const domainNorm = normalize((project.domain || "").replace(/^https?:\/\//, "").split("/")[0]);

  if (serperKey && !serperKey.startsWith("your-")) {
    try {
      const res = await fetch("https://google.serper.dev/places", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: project.name, location }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = (await res.json()) as { places?: SerperPlace[] };
        const match = (data.places || []).find((p) => {
          const t = normalize(p.title || "");
          const w = normalize((p.website || "").replace(/^https?:\/\//, "").split("/")[0]);
          return (
            (brandNorm && (t.includes(brandNorm) || brandNorm.includes(t))) ||
            (domainNorm && w.includes(domainNorm))
          );
        });
        if (match) {
          out.push({
            platform: "google_business",
            status: "verified",
            detail: `Found on Google Maps as "${match.title}"${
              match.rating ? ` (${match.rating}★, ${match.ratingCount ?? 0} reviews)` : ""
            }.`,
            matched: {
              title: match.title || project.name,
              rating: match.rating,
              reviews: match.ratingCount,
              address: match.address,
            },
          });
        } else {
          out.push({
            platform: "google_business",
            status: "not_found",
            detail:
              "No matching Google Business Profile found on the map. Claim/verify your profile to appear in local + AI local results.",
          });
        }
      } else {
        out.push({
          platform: "google_business",
          status: "unknown",
          detail: "Places lookup failed; verify manually.",
        });
      }
    } catch {
      out.push({
        platform: "google_business",
        status: "unknown",
        detail: "Places lookup timed out; verify manually.",
      });
    }
  } else {
    out.push({
      platform: "google_business",
      status: "manual",
      detail: "Set SERPER_API_KEY to auto-verify Google Business presence.",
    });
  }

  out.push({
    platform: "bing_places",
    status: "manual",
    detail: "No public lookup API. Verify at bingplaces.com and keep NAP consistent.",
  });
  out.push({
    platform: "apple_business",
    status: "manual",
    detail:
      "No public lookup API. Register at businessconnect.apple.com so Apple Maps / Siri / Apple Intelligence can surface you.",
  });

  return out;
}

export function generateLocalListingDrafts(
  project: Pick<Project, "name" | "domain" | "industry" | "location" | "main_offer">,
  brandProfile?: Pick<BrandProfile, "brand_voice" | "products_services" | "brand_values" | "target_audiences"> | null
): LocalListingDraft[] {
  const location = project.location || "your area";
  const industry = project.industry || "business";
  const offer = project.main_offer || `professional ${industry} services`;
  const services = (brandProfile?.products_services || [])
    .slice(0, 5)
    .map((s) => s.name)
    .filter(Boolean);
  const uvps = (brandProfile?.brand_values || []).slice(0, 3);
  const voice = brandProfile?.brand_voice || "professional and trustworthy";

  const serviceList = services.length > 0 ? services.join(", ") : offer;
  const uvpText = uvps.length > 0 ? uvps.join(". ") + "." : "";

  const baseDescription = `${project.name} provides ${serviceList} in ${location}. ${uvpText} Visit ${project.domain} to learn more.`.trim();

  return [
    {
      platform: "google_business",
      title: "Google Business Profile",
      description: `${baseDescription}\n\nTone: ${voice}. Add photos, service areas, and business hours. Enable messaging and post weekly updates about ${industry} tips.`,
      highlights: [
        `Primary category: ${industry}`,
        `Service area: ${location}`,
        `Website: ${project.domain}`,
        ...uvps.slice(0, 2).map((u) => `Highlight: ${u}`),
      ],
    },
    {
      platform: "bing_places",
      title: "Bing Places for Business",
      description: `${project.name} — ${offer} serving ${location}. ${baseDescription}`,
      highlights: [
        `Business name: ${project.name}`,
        `Industry: ${industry}`,
        `URL: https://${project.domain.replace(/^https?:\/\//, "")}`,
      ],
    },
    {
      platform: "apple_business",
      title: "Apple Business Connect",
      description: `${project.name} helps customers in ${location} with ${serviceList}. ${uvpText}`,
      highlights: [
        `Display name: ${project.name}`,
        `Category: ${industry}`,
        `Short description (under 200 chars): ${offer} in ${location}.`,
      ],
    },
  ];
}
