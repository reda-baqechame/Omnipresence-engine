import { getBacklinks } from "@/lib/providers/dataforseo";
import { generateStructured } from "@/lib/providers/ai-gateway";
import { z } from "zod";
import type { AuthorityOpportunity, AuthorityType } from "@/types/database";

const OpportunitySchema = z.object({
  opportunities: z.array(
    z.object({
      type: z.enum([
        "backlink", "listicle", "podcast", "journalist", "directory",
        "partner_page", "affiliate_page", "guest_post", "reddit_mention", "quora_mention",
      ]),
      target_site: z.string(),
      target_url: z.string().optional(),
      pitch_angle: z.string(),
      estimated_impact: z.number().min(1).max(100),
      difficulty_score: z.number().min(1).max(100),
      competitor_present: z.boolean(),
    })
  ),
});

export async function findAuthorityOpportunities(
  projectId: string,
  brandName: string,
  domain: string,
  industry: string,
  competitors: string[]
): Promise<Omit<AuthorityOpportunity, "id" | "created_at" | "updated_at">[]> {
  const opportunities: Omit<AuthorityOpportunity, "id" | "created_at" | "updated_at">[] = [];

  // Competitor backlink gap analysis
  for (const competitor of competitors.slice(0, 3)) {
    const compDomain = competitor.toLowerCase().replace(/\s+/g, "") + ".com";
    const backlinksResult = await getBacklinks(compDomain, 20);

    if (backlinksResult.success && backlinksResult.data) {
      const brandBacklinks = await getBacklinks(domain, 20);
      const brandDomains = new Set(
        (brandBacklinks.data || []).map((b) => b.domain)
      );

      for (const link of backlinksResult.data) {
        if (!brandDomains.has(link.domain)) {
          opportunities.push({
            project_id: projectId,
            type: "backlink" as AuthorityType,
            target_site: link.domain,
            target_url: link.url,
            pitch_angle: `Competitor ${competitor} has a backlink here. Pitch ${brandName} as an alternative.`,
            status: "identified",
            domain_authority: link.rank,
            estimated_impact: Math.min(link.rank, 100),
            difficulty_score: link.rank > 50 ? 70 : 40,
            competitor_present: true,
          });
        }
      }
    }
  }

  // AI-generated opportunity discovery
  const aiResult = await generateStructured(
    `You are an authority building strategist. Identify high-value opportunities for a brand to build presence on external platforms.`,
    `Find authority building opportunities for:
Brand: ${brandName}
Domain: ${domain}
Industry: ${industry}
Competitors: ${competitors.join(", ")}

Find 15 opportunities across: listicles, podcasts, directories, journalist pitches, partner pages, guest posts, Reddit threads, Quora questions.

For each, provide the target site, a pitch angle, estimated impact (1-100), difficulty (1-100), and whether competitors are likely present.`,
    OpportunitySchema
  );

  if (aiResult.success && aiResult.data) {
    for (const opp of aiResult.data.opportunities) {
      opportunities.push({
        project_id: projectId,
        type: opp.type as AuthorityType,
        target_site: opp.target_site,
        target_url: opp.target_url,
        pitch_angle: opp.pitch_angle,
        status: "identified",
        estimated_impact: opp.estimated_impact,
        difficulty_score: opp.difficulty_score,
        competitor_present: opp.competitor_present,
      });
    }
  }

  return opportunities.slice(0, 50);
}

export async function generateOutreachEmail(
  brandName: string,
  opportunity: AuthorityOpportunity
): Promise<{ email: string; followUp: string }> {
  const { generateStructured } = await import("@/lib/providers/ai-gateway");

  const EmailSchema = z.object({
    subject: z.string(),
    email: z.string(),
    follow_up: z.string(),
  });

  const result = await generateStructured(
    `You are a professional outreach specialist. Write concise, personalized outreach emails that provide value to the recipient.`,
    `Write an outreach email for:
Brand: ${brandName}
Target Site: ${opportunity.target_site}
Opportunity Type: ${opportunity.type}
Pitch Angle: ${opportunity.pitch_angle}

Write a professional email (under 150 words) and a follow-up email (under 80 words).`,
    EmailSchema
  );

  if (result.success && result.data) {
    return {
      email: `Subject: ${result.data.subject}\n\n${result.data.email}`,
      followUp: result.data.follow_up,
    };
  }

  return {
    email: `Subject: Partnership opportunity with ${brandName}\n\nHi,\n\nI noticed ${opportunity.target_site} and thought ${brandName} would be a great fit. ${opportunity.pitch_angle}\n\nWould you be open to a quick chat?\n\nBest regards`,
    followUp: `Hi,\n\nJust following up on my previous email about ${brandName}. Happy to provide more details if helpful.\n\nBest regards`,
  };
}
