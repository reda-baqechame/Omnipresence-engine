import { createHmac } from "crypto";
import type { ProviderResult, SERPResult } from "./types";
import { fetchWithTimeout } from "./http";
import { assertOmniDataClientConfigured, resolveOmniDataApiKey } from "./omnidata-auth";
import { assertWithinExternalApiBudget, recordExternalApiSpend } from "./external-api-guard";

const OMNIDATA_URL = process.env.OMNIDATA_BASE_URL?.replace(/\/$/, "");
const USE_OMNIDATA = Boolean(OMNIDATA_URL);

function getBaseUrl(): string {
  if (USE_OMNIDATA) return `${OMNIDATA_URL}/v3`;
  return "https://api.dataforseo.com/v3";
}

function getAuthHeaders(body: unknown): Record<string, string> {
  if (USE_OMNIDATA) {
    assertOmniDataClientConfigured();
    const key = resolveOmniDataApiKey();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "x-api-key": key,
    };
    const secret = process.env.OMNIDATA_SIGNING_SECRET;
    if (secret) {
      const timestamp = String(Date.now());
      const payload = JSON.stringify(body);
      const signature = createHmac("sha256", secret)
        .update(`${timestamp}.${payload}`)
        .digest("hex");
      headers["x-omnidata-timestamp"] = timestamp;
      headers["x-omnidata-signature"] = signature;
    }
    return headers;
  }

  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error("DataForSEO credentials not configured");
  }
  return {
    Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

export function isOmniDataActive(): boolean {
  return USE_OMNIDATA;
}

async function dataForSEORequest<T>(endpoint: string, body: unknown[]): Promise<T> {
  // P0 fix: this is the single chokepoint nearly every exported function in
  // this file funnels through — it previously had no rate limit and no
  // budget, so a runaway caller (or an unauthenticated route that triggers
  // one) could make unbounded paid DataForSEO/OmniData calls with nothing in
  // the codebase noticing. Callers already wrap these calls in try/catch and
  // degrade to "unavailable" on any thrown error, so this fails the same
  // honest way a network error would — never a crash, never a silent bypass.
  await assertWithinExternalApiBudget("dataforseo");

  const response = await fetchWithTimeout(`${getBaseUrl()}${endpoint}`, {
    method: "POST",
    headers: getAuthHeaders(body),
    body: JSON.stringify(body),
    timeoutMs: 30000,
  });

  if (!response.ok) {
    throw new Error(`${USE_OMNIDATA ? "OmniData" : "DataForSEO"} API error: ${response.status}`);
  }

  void recordExternalApiSpend("dataforseo");
  return response.json() as Promise<T>;
}

/**
 * Authenticated GET against OmniData (e.g. webgraph status). Signs an empty
 * object to match the server's `JSON.stringify(req.body ?? {})` for GET.
 * Returns null when OmniData isn't configured or the call fails.
 */
export async function omniDataGet<T>(endpoint: string): Promise<T | null> {
  if (!USE_OMNIDATA) return null;
  try {
    await assertWithinExternalApiBudget("dataforseo");
    const response = await fetchWithTimeout(`${getBaseUrl()}${endpoint}`, {
      method: "GET",
      headers: getAuthHeaders({}),
      timeoutMs: 15000,
    });
    if (!response.ok) return null;
    void recordExternalApiSpend("dataforseo");
    return response.json() as Promise<T>;
  } catch {
    return null;
  }
}

/** Labs-compatible POST for OmniData or DataForSEO (keyword intelligence spine). */
export async function labsApiPost<T>(endpoint: string, body: unknown[]): Promise<T | null> {
  const hasCreds =
    USE_OMNIDATA ||
    (Boolean(process.env.DATAFORSEO_LOGIN) && Boolean(process.env.DATAFORSEO_PASSWORD));
  if (!hasCreds) return null;
  try {
    return await dataForSEORequest<T>(endpoint, body);
  } catch {
    return null;
  }
}

export function hasLabsApi(): boolean {
  return (
    USE_OMNIDATA ||
    (Boolean(process.env.DATAFORSEO_LOGIN) && Boolean(process.env.DATAFORSEO_PASSWORD))
  );
}

export interface MapsPlace {
  title: string;
  address?: string;
  rating?: number;
  reviews?: number;
  domain?: string;
  position: number;
}

/**
 * Google Maps/Places lookup through OmniData (keyless Playwright scrape or Serper)
 * or DataForSEO. Returns null when no backend is configured.
 */
export async function getMapsPlaces(
  keyword: string,
  location = "United States"
): Promise<MapsPlace[] | null> {
  if (!hasLabsApi()) return null;
  try {
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items?: MapsPlace[];
        }>;
      }>;
    }>("/serp/google/maps/live", [{ keyword, location_name: location }]);
    return data.tasks?.[0]?.result?.[0]?.items || [];
  } catch {
    return null;
  }
}

export async function searchGoogleOrganic(
  keyword: string,
  location = "United States",
  brandDomain: string,
  competitors: string[],
  device: "desktop" | "mobile" = "desktop"
): Promise<ProviderResult<SERPResult>> {
  try {
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{
            type: string;
            rank_absolute?: number;
            title?: string;
            url?: string;
            description?: string;
            items?: Array<{ title?: string; url?: string }>;
          }>;
        }>;
      }>;
    }>("/serp/google/organic/live/advanced", [
      {
        keyword,
        location_name: location,
        language_code: "en",
        device,
        os: device === "mobile" ? "android" : "windows",
        depth: 20,
        load_async_ai_overview: true,
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    const organicResults = items
      .filter((i) => i.type === "organic")
      .map((i) => ({
        title: i.title || "",
        url: i.url || "",
        position: i.rank_absolute || 0,
      }));

    const aiOverviewItem = items.find((i) => i.type === "ai_overview");
    const aiOverview = aiOverviewItem
      ? {
          present: true,
          text: aiOverviewItem.description,
          citedUrls: (aiOverviewItem.items || []).map((s) => s.url || "").filter(Boolean),
          citedDomains: (aiOverviewItem.items || [])
            .map((s) => {
              try {
                return new URL(s.url || "").hostname.replace(/^www\./, "");
              } catch {
                return "";
              }
            })
            .filter(Boolean),
        }
      : undefined;

    const domainLower = brandDomain.toLowerCase().replace(/^www\./, "");
    const brandInResults = organicResults.some((r) =>
      r.url.toLowerCase().includes(domainLower)
    );

    const competitorInResults: Record<string, boolean> = {};
    for (const comp of competitors) {
      competitorInResults[comp] = organicResults.some((r) =>
        r.url.toLowerCase().includes(comp.toLowerCase().replace(/\s+/g, ""))
      );
    }

    const serpFeatures = Array.from(
      new Set(items.map((i) => i.type).filter((t) => t && t !== "organic"))
    );

    if (organicResults.length === 0) {
      return {
        success: false,
        error: USE_OMNIDATA
          ? "OmniData returned no organic results"
          : "SERP returned no organic results",
      };
    }

    return {
      success: true,
      data: { organicResults, aiOverview, brandInResults, competitorInResults, serpFeatures },
      creditsUsed: USE_OMNIDATA ? 0 : 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "SERP request failed",
    };
  }
}

export interface SerpIntelligenceResult {
  keyword: string;
  location: string;
  device: "desktop" | "mobile";
  organic: Array<{ position: number; title: string; url: string; domain: string; description?: string }>;
  ads: Array<{ position: number; title: string; url: string; domain: string }>;
  peopleAlsoAsk: string[];
  localPack: Array<{ title: string; url?: string }>;
  featuredSnippet?: { title?: string; url?: string; description?: string };
  aiOverview?: { present: boolean; text?: string; citedUrls: string[]; citedDomains: string[] };
  featureTypes: string[];
  provider: "omnidata" | "dataforseo";
}

function domainOf(url?: string): string {
  try {
    return new URL(url || "").hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Full SERP-feature decomposition for the SERP Intelligence explorer: organic,
 * paid/ads, People-Also-Ask, local pack, featured snippet, AI Overview, and the
 * distinct feature types present. Uses the same DataForSEO-compatible endpoint
 * (served sovereign by OmniData when active). Returns null when unavailable so
 * the caller labels the surface honestly instead of fabricating a SERP.
 */
export async function getSerpIntelligence(
  keyword: string,
  location = "United States",
  device: "desktop" | "mobile" = "desktop"
): Promise<SerpIntelligenceResult | null> {
  try {
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{
            type: string;
            rank_absolute?: number;
            title?: string;
            url?: string;
            description?: string;
            domain?: string;
            items?: Array<{ title?: string; url?: string; question?: string }>;
          }>;
        }>;
      }>;
    }>("/serp/google/organic/live/advanced", [
      {
        keyword,
        location_name: location,
        language_code: "en",
        device,
        os: device === "mobile" ? "android" : "windows",
        depth: 30,
        load_async_ai_overview: true,
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items;
    if (!items || items.length === 0) return null;

    const organic = items
      .filter((i) => i.type === "organic")
      .map((i) => ({
        position: i.rank_absolute || 0,
        title: i.title || "",
        url: i.url || "",
        domain: i.domain || domainOf(i.url),
        description: i.description,
      }));

    const ads = items
      .filter((i) => i.type === "paid")
      .map((i) => ({
        position: i.rank_absolute || 0,
        title: i.title || "",
        url: i.url || "",
        domain: i.domain || domainOf(i.url),
      }));

    const paaItem = items.find((i) => i.type === "people_also_ask");
    const peopleAlsoAsk = (paaItem?.items || [])
      .map((q) => q.question || q.title || "")
      .filter(Boolean);

    const localPackItem = items.find((i) => i.type === "local_pack");
    const localPack = localPackItem
      ? (localPackItem.items && localPackItem.items.length
          ? localPackItem.items.map((p) => ({ title: p.title || "", url: p.url }))
          : [{ title: localPackItem.title || "", url: localPackItem.url }]
        ).filter((p) => p.title)
      : [];

    const fsItem = items.find((i) => i.type === "featured_snippet");
    const featuredSnippet = fsItem
      ? { title: fsItem.title, url: fsItem.url, description: fsItem.description }
      : undefined;

    const aiItem = items.find((i) => i.type === "ai_overview");
    const aiOverview = aiItem
      ? {
          present: true,
          text: aiItem.description,
          citedUrls: (aiItem.items || []).map((s) => s.url || "").filter(Boolean),
          citedDomains: [...new Set((aiItem.items || []).map((s) => domainOf(s.url)).filter(Boolean))],
        }
      : undefined;

    const featureTypes = Array.from(new Set(items.map((i) => i.type).filter((t) => t && t !== "organic")));

    return {
      keyword,
      location,
      device,
      organic,
      ads,
      peopleAlsoAsk,
      localPack,
      featuredSnippet,
      aiOverview,
      featureTypes,
      provider: USE_OMNIDATA ? "omnidata" : "dataforseo",
    };
  } catch {
    return null;
  }
}

export async function searchGoogleAIMode(
  keyword: string,
  location = "United States"
): Promise<ProviderResult<{ text: string; citedUrls: string[]; citedDomains: string[] }>> {
  try {
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{
            type: string;
            text?: string;
            description?: string;
            items?: Array<{ url?: string }>;
          }>;
        }>;
      }>;
    }>("/serp/google/organic/live/advanced", [
      {
        keyword,
        location_name: location,
        language_code: "en",
        device: "desktop",
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    const aiItem = items.find((i) => i.type === "ai_overview" || i.type === "ai_mode");
    const citedUrls = (aiItem?.items || []).map((s) => s.url || "").filter(Boolean);
    const citedDomains = citedUrls
      .map((u) => {
        try {
          return new URL(u).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      })
      .filter(Boolean);

    return {
      success: true,
      data: {
        text: aiItem?.text || aiItem?.description || "",
        citedUrls,
        citedDomains,
      },
      creditsUsed: USE_OMNIDATA ? 0 : 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "AI Mode search failed",
    };
  }
}

export async function getBacklinks(
  domain: string,
  limit = 50
): Promise<ProviderResult<Array<{ url: string; domain: string; rank: number }>>> {
  try {
    if (USE_OMNIDATA) {
      const data = await dataForSEORequest<{
        tasks: Array<{
          result: Array<{
            items: Array<{
              source_url: string;
              source_domain: string;
              domain_rank?: number;
            }>;
          }>;
        }>;
      }>("/backlinks/summary/live", [{ target: domain, limit }]);

      const items = data.tasks?.[0]?.result?.[0]?.items || [];
      return {
        success: true,
        data: items.slice(0, limit).map((i) => ({
          url: i.source_url,
          domain: i.source_domain,
          rank: i.domain_rank ?? 0,
        })),
        creditsUsed: 0,
      };
    }

    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{
            url_from: string;
            domain_from: string;
            rank: number;
          }>;
        }>;
      }>;
    }>("/backlinks/backlinks/live", [
      {
        target: domain,
        limit,
        order_by: ["rank,desc"],
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    return {
      success: true,
      data: items.map((i) => ({
        url: i.url_from,
        domain: i.domain_from,
        rank: i.rank,
      })),
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Backlinks request failed",
    };
  }
}

export interface BacklinkGraphLink {
  sourceUrl: string;
  sourceDomain: string;
  targetUrl: string;
  anchor: string;
  rel: string[];
  nofollow: boolean;
  sponsored: boolean;
  ugc: boolean;
  firstSeen: string;
  lastSeen: string;
  domainRank?: number;
  spamRisk: number;
  linkValue: number;
  verification: "crawl_verified" | "lost" | "candidate";
}

export interface BacklinkGraph {
  target: string;
  totalLinks: number;
  referringDomains: number;
  nofollowCount: number;
  dofollowCount: number;
  newCount: number;
  lostCount: number;
  toxicCount: number;
  dataSource: "crawl_verified" | "candidate" | "unavailable";
  persisted: boolean;
  links: BacklinkGraphLink[];
}

export interface LinkIntersectionRow {
  sourceDomain: string;
  linksTo: string[];
  count: number;
  authority: number | null;
  brandGap: boolean;
}

export interface LinkIntersection {
  target: string;
  competitors: string[];
  minOverlap: number;
  dataSource: "commoncrawl_webgraph" | "unavailable";
  rows: LinkIntersectionRow[];
}

/**
 * URL-level Presence Backlink Graph (crawl-verified links with anchor + rel +
 * first/last seen) via OmniData's /backlinks/graph/live. Returns null when
 * OmniData isn't configured. This is the URL-level companion to getBacklinks
 * (domain-level) and the moat behind anchor/rel/temporal link intelligence.
 */
export async function getBacklinkGraph(
  domain: string,
  maxSources = 40
): Promise<BacklinkGraph | null> {
  if (!USE_OMNIDATA) return null;
  try {
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          target?: string;
          total_links?: number;
          referring_domains?: number;
          nofollow_count?: number;
          dofollow_count?: number;
          data_source?: BacklinkGraph["dataSource"];
          persisted?: boolean;
          new_count?: number;
          lost_count?: number;
          toxic_count?: number;
          items?: Array<{
            source_url: string;
            source_domain: string;
            target_url: string;
            anchor?: string;
            rel?: string[];
            nofollow?: boolean;
            sponsored?: boolean;
            ugc?: boolean;
            first_seen?: string;
            last_seen?: string;
            domain_rank?: number;
            spam_risk?: number;
            link_value?: number;
            verification?: BacklinkGraphLink["verification"];
          }>;
        }>;
      }>;
    }>("/backlinks/graph/live", [{ target: domain, max_sources: maxSources }]);
    const r = data.tasks?.[0]?.result?.[0];
    if (!r) return null;
    return {
      target: r.target ?? domain,
      totalLinks: r.total_links ?? 0,
      referringDomains: r.referring_domains ?? 0,
      nofollowCount: r.nofollow_count ?? 0,
      dofollowCount: r.dofollow_count ?? 0,
      newCount: r.new_count ?? 0,
      lostCount: r.lost_count ?? 0,
      toxicCount: r.toxic_count ?? 0,
      dataSource: r.data_source ?? "unavailable",
      persisted: Boolean(r.persisted),
      links: (r.items ?? []).map((i) => ({
        sourceUrl: i.source_url,
        sourceDomain: i.source_domain,
        targetUrl: i.target_url,
        anchor: i.anchor ?? "",
        rel: i.rel ?? [],
        nofollow: Boolean(i.nofollow),
        sponsored: Boolean(i.sponsored),
        ugc: Boolean(i.ugc),
        firstSeen: i.first_seen ?? "",
        lastSeen: i.last_seen ?? "",
        domainRank: i.domain_rank,
        spamRisk: i.spam_risk ?? 0,
        linkValue: i.link_value ?? 0,
        verification: i.verification ?? "crawl_verified",
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Competitor link intersection (referring domains linking to N+ competitors,
 * brand-gap first) via OmniData's /backlinks/intersection/live. Returns null
 * when OmniData isn't configured.
 */
export async function getLinkIntersection(
  domain: string,
  competitors: string[],
  minOverlap = 2
): Promise<LinkIntersection | null> {
  if (!USE_OMNIDATA || competitors.length === 0) return null;
  try {
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          target?: string;
          competitors?: string[];
          min_overlap?: number;
          data_source?: LinkIntersection["dataSource"];
          rows?: Array<{
            source_domain: string;
            links_to?: string[];
            count?: number;
            authority?: number | null;
            brand_gap?: boolean;
          }>;
        }>;
      }>;
    }>("/backlinks/intersection/live", [
      { target: domain, competitors, min_overlap: minOverlap },
    ]);
    const r = data.tasks?.[0]?.result?.[0];
    if (!r) return null;
    return {
      target: r.target ?? domain,
      competitors: r.competitors ?? competitors,
      minOverlap: r.min_overlap ?? minOverlap,
      dataSource: r.data_source ?? "unavailable",
      rows: (r.rows ?? []).map((row) => ({
        sourceDomain: row.source_domain,
        linksTo: row.links_to ?? [],
        count: row.count ?? 0,
        authority: row.authority ?? null,
        brandGap: Boolean(row.brand_gap),
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Real Common Crawl domain authority (0-100 harmonic centrality) + the true
 * distinct referring-domain count, via OmniData's /domain/authority/live. This
 * is the free DR replacement; returns null when OmniData isn't configured or the
 * webgraph isn't ingested yet (caller falls back to Tranco/rank.to).
 */
export async function getOmniDataAuthority(domain: string): Promise<{
  authority: number | null;
  referringDomains: number | null;
  source: "commoncrawl_webgraph" | "unavailable";
} | null> {
  if (!USE_OMNIDATA) return null;
  try {
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          authority?: number | null;
          referring_domains?: number | null;
          data_source?: string;
        }>;
      }>;
    }>("/domain/authority/live", [{ target: domain }]);
    const r = data.tasks?.[0]?.result?.[0];
    if (!r) return null;
    return {
      authority: typeof r.authority === "number" ? r.authority : null,
      referringDomains: typeof r.referring_domains === "number" ? r.referring_domains : null,
      source: r.data_source === "commoncrawl_webgraph" ? "commoncrawl_webgraph" : "unavailable",
    };
  } catch {
    return null;
  }
}

/**
 * Real average CPC (USD) for keywords from the Google Ads Keyword Planner via
 * OmniData. Returns null when the planner is not configured so callers can fall
 * back to industry defaults honestly.
 */
export async function getRealKeywordCpc(keywords: string[]): Promise<number | null> {
  if (!USE_OMNIDATA || keywords.length === 0) return null;
  try {
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          data_source?: string;
          metrics?: Array<{ cpc?: number }>;
        }>;
      }>;
    }>("/keywords/metrics/live", [{ keywords: keywords.slice(0, 200) }]);

    const block = data.tasks?.[0]?.result?.[0];
    if (block?.data_source !== "keyword_planner" || !block.metrics?.length) return null;
    const cpcs = block.metrics
      .map((m) => m.cpc)
      .filter((c): c is number => typeof c === "number" && c > 0);
    if (cpcs.length === 0) return null;
    return Math.round((cpcs.reduce((a, b) => a + b, 0) / cpcs.length) * 100) / 100;
  } catch {
    return null;
  }
}

export type LLMPlatform = "google" | "chat_gpt";

export interface LLMMentionSource {
  url?: string;
  domain?: string;
  title?: string;
}

export interface LLMMentionItem {
  question?: string;
  answer?: string;
  sources: LLMMentionSource[];
  aiSearchVolume?: number;
  platform: LLMPlatform;
}

export async function getLLMMentionsAggregated(
  domain: string,
  platform: LLMPlatform = "google",
  location = "United States"
): Promise<ProviderResult<{ mentions: number; citations: number; impressions: number }>> {
  if (USE_OMNIDATA) {
    return { success: false, error: "LLM Mentions not available on OmniData — use Perplexity/SERP stack" };
  }
  try {
    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{
            mentions?: number;
            ai_search_volume?: number;
            impressions?: number;
          }>;
        }>;
      }>;
    }>("/ai_optimization/llm_mentions/aggregated_metrics/live", [
      {
        target: [{ domain: cleanDomain, search_scope: ["sources"] }],
        platform,
        location_name: platform === "chat_gpt" ? "United States" : location,
        language_code: "en",
      },
    ]);

    const item = data.tasks?.[0]?.result?.[0]?.items?.[0];
    return {
      success: true,
      data: {
        mentions: item?.mentions ?? 0,
        citations: item?.mentions ?? 0,
        impressions: item?.impressions ?? item?.ai_search_volume ?? 0,
      },
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "LLM Mentions aggregated failed",
    };
  }
}

export async function searchLLMMentions(
  keyword: string,
  platform: LLMPlatform = "google",
  location = "United States"
): Promise<ProviderResult<LLMMentionItem[]>> {
  if (USE_OMNIDATA) {
    return { success: false, error: "LLM Mentions not available on OmniData" };
  }
  try {
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{
            question?: string;
            answer?: string;
            sources?: Array<{ url?: string; domain?: string; title?: string }>;
            ai_search_volume?: number;
            platform?: string;
          }>;
        }>;
      }>;
    }>("/ai_optimization/llm_mentions/search/live", [
      {
        keyword,
        platform,
        location_name: platform === "chat_gpt" ? "United States" : location,
        language_code: "en",
        limit: 10,
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    return {
      success: true,
      data: items.map((i) => ({
        question: i.question,
        answer: i.answer,
        sources: (i.sources || []).map((s) => ({
          url: s.url,
          domain: s.domain,
          title: s.title,
        })),
        aiSearchVolume: i.ai_search_volume,
        platform,
      })),
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "LLM Mentions search failed",
    };
  }
}

export async function crossAggregatedLLMMetrics(
  domains: string[],
  platform: LLMPlatform = "google"
): Promise<ProviderResult<Record<string, { mentions: number; citations: number }>>> {
  if (USE_OMNIDATA) {
    return { success: false, error: "LLM Mentions not available on OmniData" };
  }
  try {
    const targets = domains.map((d) => ({
      domain: d.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0],
      search_scope: ["sources"],
    }));

    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{
            target?: string;
            mentions?: number;
          }>;
        }>;
      }>;
    }>("/ai_optimization/llm_mentions/cross_aggregated_metrics/live", [
      {
        targets,
        platform,
        location_name: "United States",
        language_code: "en",
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    const out: Record<string, { mentions: number; citations: number }> = {};
    for (const item of items) {
      const key = item.target || "unknown";
      out[key] = { mentions: item.mentions ?? 0, citations: item.mentions ?? 0 };
    }
    return { success: true, data: out, creditsUsed: 1 };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Cross aggregated LLM metrics failed",
    };
  }
}

export async function getLLMTopDomains(
  keyword: string,
  platform: LLMPlatform = "google"
): Promise<ProviderResult<Array<{ domain: string; mentions: number }>>> {
  if (USE_OMNIDATA) {
    return { success: false, error: "LLM Mentions not available on OmniData" };
  }
  try {
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{ domain?: string; mentions?: number }>;
        }>;
      }>;
    }>("/ai_optimization/llm_mentions/top_domains/live", [
      {
        keyword,
        platform,
        location_name: "United States",
        language_code: "en",
        limit: 20,
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    return {
      success: true,
      data: items.map((i) => ({ domain: i.domain || "", mentions: i.mentions ?? 0 })),
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "LLM top domains failed",
    };
  }
}

export async function getKeywordSuggestionsLive(seed: string): Promise<{
  seed: string;
  suggestions: Array<{ keyword: string; volume_estimate?: number; source?: string }>;
  related: Array<{ keyword: string; volume_estimate?: number }>;
} | null> {
  if (USE_OMNIDATA) {
    try {
      const omnidata = await labsApiPost<{
        tasks: Array<{ result: Array<{ suggestions?: unknown[]; related?: unknown[] }> }>;
      }>("/keywords/suggestions/live", [{ keyword: seed }]);
      const block = omnidata?.tasks?.[0]?.result?.[0] as {
        suggestions?: Array<{ keyword: string; volume_estimate?: number; source?: string }>;
        related?: Array<{ keyword: string; volume_estimate?: number }>;
      } | undefined;
      if (block?.suggestions?.length) {
        return { seed, suggestions: block.suggestions, related: block.related || [] };
      }
    } catch {
      /* fall through */
    }
  }

  const hasDataForSeo =
    Boolean(process.env.DATAFORSEO_LOGIN) && Boolean(process.env.DATAFORSEO_PASSWORD);
  if (!hasDataForSeo && !USE_OMNIDATA) {
    const { getKeywordSuggestionsSerper } = await import("@/lib/providers/serper-keywords");
    return getKeywordSuggestionsSerper(seed);
  }

  if (USE_OMNIDATA && !hasDataForSeo) {
    const { getKeywordSuggestionsSerper } = await import("@/lib/providers/serper-keywords");
    return getKeywordSuggestionsSerper(seed);
  }

  try {
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{
            keyword: string;
            keyword_info?: { search_volume?: number };
          }>;
        }>;
      }>;
    }>("/dataforseo_labs/google/keyword_suggestions/live", [
      {
        keyword: seed,
        location_name: "United States",
        language_code: "en",
        include_seed_keyword: true,
        limit: 25,
      },
    ]);

    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    const suggestions = items.slice(0, 15).map((i) => ({
      keyword: i.keyword,
      volume_estimate: i.keyword_info?.search_volume,
      source: "dataforseo_labs",
    }));

    const ideasData = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          items: Array<{
            keyword: string;
            keyword_info?: { search_volume?: number };
          }>;
        }>;
      }>;
    }>("/dataforseo_labs/google/keyword_ideas/live", [
      {
        keywords: [seed],
        location_name: "United States",
        language_code: "en",
        limit: 15,
      },
    ]);

    const related = (ideasData.tasks?.[0]?.result?.[0]?.items || [])
      .filter((i) => i.keyword !== seed)
      .slice(0, 10)
      .map((i) => ({
        keyword: i.keyword,
        volume_estimate: i.keyword_info?.search_volume,
      }));

    return { seed, suggestions, related };
  } catch {
    const { getKeywordSuggestionsSerper } = await import("@/lib/providers/serper-keywords");
    return getKeywordSuggestionsSerper(seed);
  }
}

export async function resolveCompetitorDomain(
  competitorName: string,
  industry?: string
): Promise<string | null> {
  const query = `${competitorName} ${industry || ""} official site`.trim();
  const res = await searchGoogleOrganic(query, "United States", "", []);
  if (!res.success || !res.data?.organicResults?.length) return null;
  const top = res.data.organicResults[0];
  try {
    return new URL(top.url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function checkRankPosition(
  keyword: string,
  domain: string,
  location = "United States"
): Promise<
  ProviderResult<{
    position: number | null;
    url?: string;
    serp_features: string[];
    striking_distance: boolean;
  }>
> {
  try {
    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    const data = await dataForSEORequest<{
      tasks: Array<{
        result: Array<{
          snapshot?: {
            position: number | null;
            url?: string;
            serp_features?: string[];
          };
          striking_distance?: boolean;
        }>;
      }>;
    }>("/rank_tracker/check/live", [
      { keyword, domain: cleanDomain, location_name: location },
    ]);

    const result = data.tasks?.[0]?.result?.[0];
    const snapshot = result?.snapshot;
    return {
      success: true,
      data: {
        position: snapshot?.position ?? null,
        url: snapshot?.url,
        serp_features: snapshot?.serp_features || [],
        striking_distance: result?.striking_distance ?? false,
      },
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Rank check failed",
    };
  }
}
