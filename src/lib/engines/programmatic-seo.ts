import type { ContentAssetType } from "@/types/database";

/** Hard ceiling for a single programmatic campaign (10k-row matrices). */
export const PSEO_MAX_PAGES = 10000;

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
  const maxPages = Math.min(input.maxPages ?? 50, PSEO_MAX_PAGES);
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
  return Math.min(services * locations * keywords, Math.min(input.maxPages ?? 50, PSEO_MAX_PAGES));
}

/** Per-page Search Console performance (from searchAnalytics with dimensions=["page"]). */
export interface PseoPagePerformance {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface PseoRefreshCandidate {
  url: string;
  reason: string;
  priority: number;
  clicks: number;
  impressions: number;
  position: number;
}

/** Expected organic CTR by average position (industry curve, approximate). */
function expectedCtr(position: number): number {
  if (position <= 1) return 0.28;
  if (position <= 2) return 0.15;
  if (position <= 3) return 0.1;
  if (position <= 5) return 0.06;
  if (position <= 10) return 0.025;
  return 0.01;
}

/**
 * GSC refresh loop: scan real per-page Search Console performance and flag
 * programmatic pages worth refreshing — striking-distance pages, high-impression
 * low-CTR pages, and high-impression zero-click pages. Sorted by opportunity.
 */
export function selectPagesToRefresh(
  rows: PseoPagePerformance[],
  opts: { minImpressions?: number } = {}
): PseoRefreshCandidate[] {
  const minImpressions = opts.minImpressions ?? 50;
  const candidates: PseoRefreshCandidate[] = [];

  for (const r of rows) {
    if (r.impressions < minImpressions) continue;
    const reasons: string[] = [];
    let priority = 0;

    // Striking distance — small push can win page-1 / AI-citation eligibility.
    if (r.position > 7 && r.position <= 20) {
      reasons.push(`striking distance (avg position ${r.position.toFixed(1)})`);
      priority += r.impressions * 0.5;
    }

    // High impressions but CTR well below expectation for its position.
    const target = expectedCtr(r.position);
    if (r.ctr < target * 0.5) {
      reasons.push(
        `low CTR ${(r.ctr * 100).toFixed(1)}% vs ~${(target * 100).toFixed(0)}% expected`
      );
      priority += r.impressions * 0.3;
    }

    // Lots of impressions, no clicks — title/meta or intent mismatch.
    if (r.clicks === 0 && r.impressions >= minImpressions * 2) {
      reasons.push("high impressions, zero clicks");
      priority += r.impressions * 0.4;
    }

    if (reasons.length) {
      candidates.push({
        url: r.url,
        reason: reasons.join("; "),
        priority: Math.round(priority),
        clicks: r.clicks,
        impressions: r.impressions,
        position: Math.round(r.position * 10) / 10,
      });
    }
  }

  return candidates.sort((a, b) => b.priority - a.priority);
}

export function parseCsvLines(csv: string): string[] {
  return csv
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse matrix rows: service,location[,keyword] per line (header optional). */
export function parsePseoMatrixCsv(csv: string): {
  services: string[];
  locations: string[];
  keywords: string[];
} {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { services: [], locations: [], keywords: [] };

  const header = lines[0].toLowerCase();
  const hasHeader = header.includes("service") || header.includes("location");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const services = new Set<string>();
  const locations = new Set<string>();
  const keywords = new Set<string>();

  for (const line of dataLines) {
    const parts = line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    const service = parts[0];
    const location = parts[1];
    const keyword = parts[2];
    if (service) services.add(service);
    if (location) locations.add(location);
    if (keyword) keywords.add(keyword);
  }

  return {
    services: [...services],
    locations: [...locations],
    keywords: [...keywords],
  };
}
