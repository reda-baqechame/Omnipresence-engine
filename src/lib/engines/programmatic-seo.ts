import type { ContentAssetType } from "@/types/database";

export type PseoTemplateType = "location_page" | "service_page" | "best_of_page" | "comparison_page";

export interface PseoCampaignInput {
  name: string;
  templateType: PseoTemplateType;
  urlPattern?: string;
  services: string[];
  locations: string[];
  keywords?: string[];
  maxPages?: number;
}

export interface PseoPageSpec {
  topic: string;
  slug: string;
  url: string;
  type: ContentAssetType;
  metadata: Record<string, unknown>;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function applyUrlPattern(pattern: string, vars: Record<string, string>): string {
  let url = pattern;
  for (const [key, value] of Object.entries(vars)) {
    url = url.replace(new RegExp(`\\{${key}\\}`, "g"), slugify(value));
  }
  return url.replace(/\/+/g, "/");
}

function buildTopic(
  templateType: PseoTemplateType,
  service: string,
  location: string,
  keyword?: string
): string {
  switch (templateType) {
    case "location_page":
      return `${service} in ${location}`;
    case "service_page":
      return keyword ? `${keyword} — ${service}` : service;
    case "best_of_page":
      return `Best ${service} in ${location}`;
    case "comparison_page":
      return `${service} options in ${location}: comparison guide`;
    default:
      return `${service} ${location}`;
  }
}

/**
 * Expand keyword × location × service matrix into page specs.
 * Caps at maxPages to prevent runaway generation.
 */
export function expandPseoMatrix(
  input: PseoCampaignInput,
  domain: string
): PseoPageSpec[] {
  const maxPages = input.maxPages ?? 50;
  const pattern = input.urlPattern || "/{type}/{slug}";
  const services = input.services.length ? input.services : ["services"];
  const locations = input.locations.length ? input.locations : ["local"];
  const keywords = input.keywords?.length ? input.keywords : [];
  const specs: PseoPageSpec[] = [];
  const seen = new Set<string>();

  const typeMap: Record<PseoTemplateType, ContentAssetType> = {
    location_page: "location_page",
    service_page: "service_page",
    best_of_page: "best_of_page",
    comparison_page: "comparison_page",
  };
  const contentType = typeMap[input.templateType];

  for (const service of services) {
    for (const location of locations) {
      const keywordList = keywords.length ? keywords : [""];
      for (const keyword of keywordList) {
        if (specs.length >= maxPages) return specs;

        const topic = buildTopic(input.templateType, service, location, keyword || undefined);
        const slug = slugify(
          keyword ? `${keyword}-${service}-${location}` : `${service}-${location}`
        );
        if (seen.has(slug)) continue;
        seen.add(slug);

        const path = applyUrlPattern(pattern, {
          type: input.templateType.replace("_page", ""),
          slug,
          service: slugify(service),
          location: slugify(location),
          keyword: keyword ? slugify(keyword) : "",
        });

        const base = domain.startsWith("http") ? domain : `https://${domain}`;
        const url = new URL(path.startsWith("/") ? path : `/${path}`, base).toString();

        specs.push({
          topic,
          slug,
          url,
          type: contentType,
          metadata: {
            service,
            location,
            keyword: keyword || null,
            template_type: input.templateType,
            programmatic: true,
          },
        });
      }
    }
  }

  return specs;
}

export function estimatePseoMatrixSize(input: PseoCampaignInput): number {
  const services = Math.max(input.services.length, 1);
  const locations = Math.max(input.locations.length, 1);
  const keywords = input.keywords?.length ? input.keywords.length : 1;
  return Math.min(services * locations * keywords, input.maxPages ?? 50);
}

export function parseCsvLines(csv: string): string[] {
  return csv
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
