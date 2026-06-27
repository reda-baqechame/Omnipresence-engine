import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * AI citation-gap finder (Phase 10).
 *
 * Uses the already-MEASURED citation_sources captured during scans. A citation
 * gap is a third-party source domain that AI engines cite when answering for
 * your competitors, but that has never cited you. These are the highest-leverage
 * earned-media / outreach targets: getting mentioned there directly increases
 * the odds an AI engine retrieves and cites you for the same prompts.
 */

export type OutreachTactic =
  | "guest_post"
  | "product_listing"
  | "review_pitch"
  | "data_contribution"
  | "expert_quote"
  | "correction_request";

export interface CitationGap {
  source_domain: string;
  competitor_citations: number;
  competitors: string[];
  prompts: string[];
  /** Heuristic difficulty of getting placed (0-100, lower = easier). */
  difficulty: number;
  tactic: OutreachTactic;
  outreach_angle: string;
}

const LISTICLE_HINTS = ["best", "top", "review", "compare", "alternative", "vs", "list"];
const DIRECTORY_HINTS = ["g2.com", "capterra", "crunchbase", "producthunt", "trustpilot", "getapp", "softwareadvice"];
const COMMUNITY_HINTS = ["reddit.com", "quora.com", "news.ycombinator", "stackoverflow", "medium.com"];

function classify(domain: string, prompts: string[]): { tactic: OutreachTactic; difficulty: number; angle: string } {
  const d = domain.toLowerCase();
  const promptBlob = prompts.join(" ").toLowerCase();

  if (DIRECTORY_HINTS.some((h) => d.includes(h))) {
    return {
      tactic: "product_listing",
      difficulty: 20,
      angle: `Claim/complete your profile on ${domain} (categories, screenshots, integrations). AI engines lean on these structured directories for comparisons.`,
    };
  }
  if (COMMUNITY_HINTS.some((h) => d.includes(h))) {
    return {
      tactic: "expert_quote",
      difficulty: 35,
      angle: `Contribute genuinely useful answers/threads on ${domain} where your category is discussed. Avoid spam; add data and a clear use-case.`,
    };
  }
  if (LISTICLE_HINTS.some((h) => promptBlob.includes(h) || d.includes(h))) {
    return {
      tactic: "review_pitch",
      difficulty: 45,
      angle: `Pitch ${domain} for inclusion in their roundup/comparison: offer a free account, unique differentiators, and a fact sheet they can cite.`,
    };
  }
  return {
    tactic: "guest_post",
    difficulty: 55,
    angle: `Offer ${domain} an original data-backed contribution relevant to the prompts they already rank for, with a natural mention of your brand.`,
  };
}

export async function findCitationGaps(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ available: boolean; gaps: CitationGap[]; reason?: string }> {
  const { data: rows } = await supabase
    .from("citation_sources")
    .select("source_domain, cites_brand, cites_competitor, competitor_name, prompt_text")
    .eq("project_id", projectId);

  if (!rows || rows.length === 0) {
    return { available: false, gaps: [], reason: "No citation sources yet. Run a visibility scan first." };
  }

  // Domains that have EVER cited the brand are not gaps.
  const brandCitedDomains = new Set(
    rows.filter((r) => r.cites_brand).map((r) => (r.source_domain || "").toLowerCase())
  );

  const byDomain = new Map<
    string,
    { count: number; competitors: Set<string>; prompts: Set<string> }
  >();

  for (const r of rows) {
    const domain = (r.source_domain || "").toLowerCase();
    if (!domain) continue;
    if (!r.cites_competitor) continue;
    if (brandCitedDomains.has(domain)) continue;

    const entry = byDomain.get(domain) || { count: 0, competitors: new Set<string>(), prompts: new Set<string>() };
    entry.count += 1;
    if (r.competitor_name) entry.competitors.add(r.competitor_name);
    if (r.prompt_text) entry.prompts.add(r.prompt_text);
    byDomain.set(domain, entry);
  }

  const gaps: CitationGap[] = Array.from(byDomain.entries())
    .map(([domain, e]) => {
      const prompts = Array.from(e.prompts).slice(0, 5);
      const { tactic, difficulty, angle } = classify(domain, prompts);
      return {
        source_domain: domain,
        competitor_citations: e.count,
        competitors: Array.from(e.competitors),
        prompts,
        difficulty,
        tactic,
        outreach_angle: angle,
      };
    })
    // Prioritize sources citing the most competitors and easiest to win.
    .sort((a, b) => b.competitor_citations - a.competitor_citations || a.difficulty - b.difficulty);

  return { available: true, gaps };
}
