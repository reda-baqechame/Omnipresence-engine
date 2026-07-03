import { fetchWithTimeout } from "./http";
import { getGoogleCloudApiKey, hasGoogleCloudApiKey } from "./google-cloud-key";
import { logProviderError } from "@/lib/observability/log";

/**
 * Knowledge-graph providers (Phase 15) — Wikidata, DBpedia, and the Google
 * Knowledge Graph Search API. Wikidata/DBpedia are keyless; Google KG uses a
 * free API key (GOOGLE_KG_API_KEY). All degrade gracefully.
 */

const UA = "OmniPresence-Entity/1.0 (https://github.com)";

// ---------- Google Knowledge Graph Search (free key) ----------
export function hasGoogleKgCapability(): boolean {
  return hasGoogleCloudApiKey();
}

export interface KgEntity {
  name: string;
  description?: string;
  detailedDescription?: string;
  url?: string;
  types: string[];
  score: number;
}

export async function googleKnowledgeGraph(query: string): Promise<{ available: boolean; reason?: string; entities: KgEntity[] }> {
  const key = getGoogleCloudApiKey();
  if (!key) {
    return { available: false, reason: "Google Cloud API key not set (enable Knowledge Graph Search API on your key).", entities: [] };
  }
  try {
    const params = new URLSearchParams({
      query,
      key,
      limit: "5",
      indent: "false",
    });
    const res = await fetchWithTimeout(`https://kgsearch.googleapis.com/v1/entities:search?${params}`, { timeoutMs: 12_000 });
    if (!res.ok) return { available: false, reason: `Google KG ${res.status}`, entities: [] };
    const data = (await res.json()) as {
      itemListElement?: Array<{
        resultScore?: number;
        result?: {
          name?: string;
          description?: string;
          detailedDescription?: { articleBody?: string; url?: string };
          url?: string;
          "@type"?: string[];
        };
      }>;
    };
    const entities: KgEntity[] = (data.itemListElement || [])
      .filter((i) => i.result?.name)
      .map((i) => ({
        name: i.result!.name!,
        description: i.result!.description,
        detailedDescription: i.result!.detailedDescription?.articleBody,
        url: i.result!.detailedDescription?.url || i.result!.url,
        types: i.result!["@type"] || [],
        score: i.resultScore || 0,
      }));
    return { available: true, entities };
  } catch (error) {
    logProviderError("google-kg", error, { query });
    return { available: false, reason: error instanceof Error ? error.message : "Google KG failed", entities: [] };
  }
}

// ---------- Wikidata entity details (keyless) ----------
export interface WikidataDetails {
  qid?: string;
  officialWebsite?: string;
  instanceOf: string[];
  sameAs: string[];
}

export async function getWikidataDetails(qid: string): Promise<{ available: boolean; details?: WikidataDetails }> {
  if (!qid) return { available: false };
  try {
    const res = await fetchWithTimeout(
      `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(qid)}.json`,
      { headers: { "User-Agent": UA }, timeoutMs: 12_000 }
    );
    if (!res.ok) return { available: false };
    const data = (await res.json()) as {
      entities?: Record<string, { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> }>;
    };
    const entity = data.entities?.[qid];
    const claims = entity?.claims || {};

    const officialWebsite = stringClaim(claims.P856);
    const instanceOf = (claims.P31 || [])
      .map((c) => {
        const v = c.mainsnak?.datavalue?.value as { id?: string } | undefined;
        return v?.id || "";
      })
      .filter(Boolean);

    // Build sameAs from external-id properties commonly used for orgs.
    const sameAs: string[] = [];
    const crunchbase = stringClaim(claims.P2087) || stringClaim(claims.P2088);
    if (officialWebsite) sameAs.push(officialWebsite);
    if (crunchbase) sameAs.push(crunchbase);

    return { available: true, details: { qid, officialWebsite, instanceOf, sameAs } };
  } catch (error) {
    logProviderError("wikidata-details", error, { qid });
    return { available: false };
  }
}

function stringClaim(arr?: Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>): string | undefined {
  const v = arr?.[0]?.mainsnak?.datavalue?.value;
  return typeof v === "string" ? v : undefined;
}

// ---------- DBpedia lookup (keyless) ----------
export interface DbpediaResult {
  uri: string;
  label: string;
  abstract?: string;
}

export async function dbpediaLookup(query: string): Promise<{ available: boolean; results: DbpediaResult[] }> {
  try {
    const res = await fetchWithTimeout(
      `https://lookup.dbpedia.org/api/search?query=${encodeURIComponent(query)}&maxResults=5&format=json`,
      { headers: { "User-Agent": UA, Accept: "application/json" }, timeoutMs: 12_000 }
    );
    if (!res.ok) return { available: false, results: [] };
    const data = (await res.json()) as {
      docs?: Array<{ resource?: string[]; label?: string[]; comment?: string[] }>;
    };
    const results: DbpediaResult[] = (data.docs || [])
      .filter((d) => d.resource?.[0])
      .map((d) => ({
        uri: d.resource![0],
        label: stripTags(d.label?.[0] || ""),
        abstract: d.comment?.[0] ? stripTags(d.comment[0]) : undefined,
      }));
    return { available: results.length > 0, results };
  } catch (error) {
    logProviderError("dbpedia", error, { query });
    return { available: false, results: [] };
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}
