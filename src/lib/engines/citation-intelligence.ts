import { createServiceClient } from "@/lib/supabase/server";
import { queryPerplexitySonar } from "@/lib/providers/perplexity";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import {
  getLLMTopDomains,
  searchLLMMentions,
  type LLMPlatform,
} from "@/lib/providers/dataforseo";
import { hasLLMMentionsCapability } from "@/lib/config/capabilities";

export interface CitationSourceItem {
  domain: string;
  url?: string;
  platform: string;
  promptText: string;
}

export interface TopCitedDomain {
  domain: string;
  mentions: number;
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Live citation collection via Perplexity + SERP (replaces DataForSEO LLM Mentions for authority). */
export async function collectLiveCitationSources(
  prompt: string,
  brandName: string,
  brandDomain: string,
  competitors: string[],
  location = "United States"
): Promise<CitationSourceItem[]> {
  const sources: CitationSourceItem[] = [];
  const seen = new Set<string>();

  const add = (domain: string, url: string | undefined, platform: string) => {
    const key = `${platform}:${domain}:${url || ""}`;
    if (!domain || seen.has(key)) return;
    seen.add(key);
    sources.push({ domain, url, platform, promptText: prompt });
  };

  const pplx = await queryPerplexitySonar(prompt, brandName, brandDomain, competitors);
  if (pplx.success && pplx.data) {
    for (const url of pplx.data.citations) {
      add(hostnameFromUrl(url), url, "perplexity");
    }
  }

  const serp = await searchGoogleOrganicRouter(prompt, location, brandDomain, competitors);
  if (serp.success && serp.data) {
    for (const result of serp.data.organicResults.slice(0, 10)) {
      add(hostnameFromUrl(result.url), result.url, serp.provider || "serp");
    }
    for (const url of serp.data.aiOverview?.citedUrls || []) {
      add(hostnameFromUrl(url), url, `${serp.provider || "serp"}_ai_overview`);
    }
  }

  return sources;
}

/** Aggregate top cited domains from in-memory live sources (replaces getLLMTopDomains). */
export function aggregateTopCitedDomains(
  sources: CitationSourceItem[],
  limit = 10
): TopCitedDomain[] {
  const counts = new Map<string, number>();
  for (const source of sources) {
    counts.set(source.domain, (counts.get(source.domain) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([domain, mentions]) => ({ domain, mentions }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, limit);
}

/** Read stored citation_sources from the latest scan (free historical index). */
export async function getStoredCitationSources(
  projectId: string
): Promise<CitationSourceItem[]> {
  try {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("citation_sources")
      .select("prompt_text, platform, source_domain, source_url")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(500);

    return (data || []).map((row) => ({
      domain: row.source_domain,
      url: row.source_url || undefined,
      platform: row.platform,
      promptText: row.prompt_text,
    }));
  } catch {
    return [];
  }
}

export function getTopCitedDomainsFromStored(
  sources: CitationSourceItem[],
  promptText?: string,
  limit = 10
): TopCitedDomain[] {
  const filtered = promptText
    ? sources.filter((s) => s.promptText === promptText)
    : sources;
  return aggregateTopCitedDomains(filtered, limit);
}

/** Optional DataForSEO boost when keys exist (AI search volume + indexed mentions). */
export async function collectDataForSEOCitationSources(
  prompt: string,
  platform: LLMPlatform,
  location = "United States"
): Promise<CitationSourceItem[]> {
  if (!hasLLMMentionsCapability()) return [];

  const mentions = await searchLLMMentions(prompt, platform, location);
  if (!mentions.success || !mentions.data) return [];

  const sources: CitationSourceItem[] = [];
  for (const item of mentions.data) {
    for (const source of item.sources) {
      const domain = source.domain || (source.url ? hostnameFromUrl(source.url) : "");
      if (!domain) continue;
      sources.push({
        domain,
        url: source.url,
        platform: `dataforseo_${platform}`,
        promptText: prompt,
      });
    }
  }
  return sources;
}

export async function getDataForSEOTopDomains(
  prompt: string,
  platform: LLMPlatform
): Promise<TopCitedDomain[]> {
  if (!hasLLMMentionsCapability()) return [];

  const topDomains = await getLLMTopDomains(prompt, platform);
  if (!topDomains.success || !topDomains.data) return [];

  return topDomains.data.map((td) => ({
    domain: td.domain,
    mentions: td.mentions,
  }));
}
