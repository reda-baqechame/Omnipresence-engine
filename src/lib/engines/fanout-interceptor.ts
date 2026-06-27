import { z } from "zod";
import { generateStructured } from "@/lib/providers/ai-gateway";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import { preferLiveData } from "@/lib/config/capabilities";

/**
 * Fan-out interceptor (Phase 10, Edward Sturm lever, labeled honestly).
 *
 * Modern AI answer engines (ChatGPT Search, Gemini, AI Overviews) decompose a
 * user prompt into several sub-queries, retrieve for each, then synthesize. For
 * retrieval-grounded answers, "GEO collapses into SEO": if you rank on Google
 * for the likely sub-queries, you are far more likely to be retrieved + cited.
 *
 * We derive the likely sub-queries for a tracked prompt and check the brand's
 * Google rank for each, exposing where retrieval would (and would not) surface
 * the brand. All ranks are MEASURED via the SERP router; if no SERP provider is
 * configured we return unavailable rather than a false zero.
 */

const SubqueriesSchema = z.object({
  subqueries: z
    .array(z.string())
    .describe("4-8 concrete Google search queries an AI engine would issue to answer the prompt"),
});

export interface FanoutSubqueryRank {
  subquery: string;
  position: number | null;
  url?: string;
  /** True when the position would plausibly be retrieved (top 10). */
  retrievable: boolean;
}

export interface FanoutResult {
  available: boolean;
  prompt: string;
  subqueries: FanoutSubqueryRank[];
  retrievableCount: number;
  coverage: number; // 0-1 share of sub-queries where brand ranks top 10
  reason?: string;
}

export async function deriveFanoutSubqueries(prompt: string): Promise<string[]> {
  const res = await generateStructured(
    "You model how AI answer engines (ChatGPT Search, Gemini, Google AI Overviews) decompose a question into the underlying Google search queries they run before synthesizing an answer. Return only the concrete search queries.",
    `User prompt: "${prompt}"\n\nList the 4-8 distinct Google search queries an AI engine would most likely issue to research this prompt. Use natural search phrasing, not questions to the AI.`,
    SubqueriesSchema
  );
  if (!res.success || !res.data) return [];
  return Array.from(
    new Set(res.data.subqueries.map((s) => s.trim()).filter(Boolean))
  ).slice(0, 8);
}

function findDomainPosition(
  organic: Array<{ url: string; position: number }>,
  domain: string
): { position: number | null; url?: string } {
  const target = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase().split("/")[0];
  for (const r of organic) {
    try {
      const host = new URL(r.url.startsWith("http") ? r.url : `https://${r.url}`).hostname
        .replace(/^www\./, "")
        .toLowerCase();
      if (host === target || host.endsWith(`.${target}`)) {
        return { position: r.position, url: r.url };
      }
    } catch {
      continue;
    }
  }
  return { position: null };
}

export async function runFanoutInterception(
  prompt: string,
  domain: string,
  competitors: string[] = [],
  location = "United States"
): Promise<FanoutResult> {
  const subqueries = await deriveFanoutSubqueries(prompt);
  if (!subqueries.length) {
    return {
      available: false,
      prompt,
      subqueries: [],
      retrievableCount: 0,
      coverage: 0,
      reason: "Could not derive sub-queries (AI generation unavailable).",
    };
  }

  if (!preferLiveData()) {
    return {
      available: false,
      prompt,
      subqueries: subqueries.map((s) => ({ subquery: s, position: null, retrievable: false })),
      retrievableCount: 0,
      coverage: 0,
      reason: "Live SERP data disabled.",
    };
  }

  const ranks: FanoutSubqueryRank[] = [];
  let anySerp = false;

  for (const sq of subqueries) {
    const serp = await searchGoogleOrganicRouter(sq, location, domain, competitors);
    if (!serp.success || !serp.data) {
      ranks.push({ subquery: sq, position: null, retrievable: false });
      continue;
    }
    anySerp = true;
    const found = findDomainPosition(serp.data.organicResults, domain);
    ranks.push({
      subquery: sq,
      position: found.position,
      url: found.url,
      retrievable: found.position != null && found.position <= 10,
    });
  }

  if (!anySerp) {
    return {
      available: false,
      prompt,
      subqueries: ranks,
      retrievableCount: 0,
      coverage: 0,
      reason: "No SERP provider configured (set SERPER_API_KEY / Brave / OmniData).",
    };
  }

  const retrievableCount = ranks.filter((r) => r.retrievable).length;
  return {
    available: true,
    prompt,
    subqueries: ranks,
    retrievableCount,
    coverage: ranks.length ? retrievableCount / ranks.length : 0,
  };
}
