import type { Project, BrandProfile } from "@/types/database";

export interface LocalListingDraft {
  platform: "google_business" | "bing_places" | "apple_business";
  title: string;
  description: string;
  highlights: string[];
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
