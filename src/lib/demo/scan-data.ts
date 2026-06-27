import type { PromptCategory, VisibilityEngine } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { preferLiveData, hasSerpCapability, hasCitationTrackingCapability } from "@/lib/config/capabilities";
import { isProductionDeploy } from "@/lib/config/production";
import { SCAN_ENGINES } from "@/lib/config/scan-engines";
import { getOrganizationPlan } from "@/lib/plans/limits";

/** Demo mode is last-resort fallback when no live providers are configured. Never on production with keys. */
export function isDemoMode(): boolean {
  if (process.env.FORCE_DEMO_MODE === "true") return true;
  if (isProductionDeploy() && (hasSerpCapability() || hasCitationTrackingCapability())) {
    return false;
  }
  return !preferLiveData();
}

/**
 * Org-aware demo decision — THE refund-safety gate.
 *
 * A paying organization must NEVER receive simulated/demo data. If the base
 * demo decision wants demo (no providers configured) but the org is on a paid
 * plan, we force real engines instead (which honestly return Unavailable rather
 * than fabricated numbers). FORCE_DEMO_MODE still wins for explicit previews.
 */
export async function resolveScanDemoMode(
  supabase: SupabaseClient,
  organizationId?: string | null
): Promise<boolean> {
  if (process.env.FORCE_DEMO_MODE === "true") return true;
  const base = isDemoMode();
  if (!base) return false;
  if (!organizationId) return base;
  try {
    const plan = await getOrganizationPlan(supabase, organizationId);
    if (plan && plan !== "free") return false; // paid orgs: real engines only
  } catch {
    // If we cannot confirm the plan, fail safe toward NOT showing demo data.
    return false;
  }
  return base;
}

export function generateDemoPrompts(
  projectId: string,
  brandName: string,
  industry: string,
  location: string,
  competitors: string[]
) {
  const templates = [
    { text: `best ${industry} in ${location}`, category: "best_of" as PromptCategory, priority: 90 },
    { text: `top rated ${industry} companies near me`, category: "best_of" as PromptCategory, priority: 85 },
    { text: `${brandName} reviews`, category: "trust" as PromptCategory, priority: 80 },
    { text: `how much does ${industry} cost in ${location}`, category: "pricing" as PromptCategory, priority: 75 },
    { text: `${industry} open now ${location}`, category: "local" as PromptCategory, priority: 85 },
    { text: `who is the best ${industry} provider`, category: "solution_aware" as PromptCategory, priority: 80 },
    ...(competitors[0]
      ? [{ text: `${brandName} vs ${competitors[0]}`, category: "comparison" as PromptCategory, priority: 88 }]
      : []),
    ...(competitors[0]
      ? [{ text: `best alternative to ${competitors[0]}`, category: "alternatives" as PromptCategory, priority: 82 }]
      : []),
    { text: `book ${industry} appointment today`, category: "transactional" as PromptCategory, priority: 92 },
    { text: `is ${brandName} reliable`, category: "trust" as PromptCategory, priority: 78 },
  ];

  return templates.map((t) => ({
    project_id: projectId,
    ...t,
    is_tracked: true,
  }));
}

export function generateDemoVisibilityResults(
  projectId: string,
  runId: string,
  brandName: string,
  brandDomain: string,
  competitors: string[],
  prompts: Array<{ text: string }>
) {
  const engines: VisibilityEngine[] = SCAN_ENGINES;
  const results = [];

  for (const prompt of prompts.slice(0, 10)) {
    for (const engine of engines) {
      const brandMentioned = Math.random() > 0.7;
      const brandCited = brandMentioned && Math.random() > 0.5;
      const competitorMentions: Record<string, boolean> = {};
      for (const comp of competitors) {
        competitorMentions[comp] = Math.random() > 0.4;
      }

      results.push({
        run_id: runId,
        project_id: projectId,
        engine,
        prompt_text: prompt.text,
        brand_mentioned: brandMentioned,
        brand_cited: brandCited,
        competitor_mentions: competitorMentions,
        competitor_citations: {},
        source_domains: brandCited ? [brandDomain] : ["competitor.com", "yelp.com", "reddit.com"].slice(0, Math.floor(Math.random() * 3) + 1),
        cited_urls: [],
        raw_response: { demo: true },
      });
    }
  }

  return results;
}

export function generateDemoBrandProfile(projectName: string, industry: string) {
  return {
    brand_name: projectName,
    brand_voice: "Professional, trustworthy, and customer-focused",
    brand_values: ["Quality", "Reliability", "Expertise", "Customer satisfaction"],
    products_services: [{ name: industry, description: `Professional ${industry} services` }],
    target_audiences: ["Local homeowners", "Business owners", "Decision makers"],
    proof_points: [
      { type: "reviews", value: "4.8 star average rating" },
      { type: "experience", value: "10+ years in business" },
    ],
    faq_database: [
      { question: `What services does ${projectName} offer?`, answer: `We provide comprehensive ${industry} services.` },
      { question: "How do I get started?", answer: "Contact us for a free consultation." },
    ],
    author_persona: "Industry expert with 15+ years experience",
    offer_capsules: [{ title: "Free Consultation", cta: "Book your free consultation today" }],
  };
}

export function generateDemoAuthorityOpportunities(projectId: string, industry: string, competitors: string[]) {
  const sites = [
    { site: "yelp.com", type: "directory" as const, impact: 75 },
    { site: "trustpilot.com", type: "directory" as const, impact: 70 },
    { site: `best${industry.replace(/\s/g, "")}.com`, type: "listicle" as const, impact: 85 },
    { site: "localchamber.org", type: "directory" as const, impact: 60 },
    { site: "industrypodcast.fm", type: "podcast" as const, impact: 80 },
    { site: "reddit.com/r/local", type: "reddit_mention" as const, impact: 65 },
    { site: "quora.com", type: "quora_mention" as const, impact: 55 },
  ];

  return sites.map((s) => ({
    project_id: projectId,
    type: s.type,
    target_site: s.site,
    pitch_angle: competitors[0]
      ? `Competitor ${competitors[0]} is listed here. Pitch for inclusion as a top ${industry} provider.`
      : `Get listed as a recommended ${industry} provider.`,
    status: "identified" as const,
    estimated_impact: s.impact,
    difficulty_score: Math.floor(Math.random() * 40) + 30,
    competitor_present: Math.random() > 0.3,
  }));
}
