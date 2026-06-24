import {
  getBacklinks,
  resolveCompetitorDomain,
  searchLLMMentions,
  getLLMTopDomains,
} from "@/lib/providers/dataforseo";
import { generateStructured } from "@/lib/providers/ai-gateway";
import { hasLLMMentionsCapability } from "@/lib/config/capabilities";
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
  competitors: string[],
  buyerPrompts: string[] = []
): Promise<Omit<AuthorityOpportunity, "id" | "created_at" | "updated_at">[]> {
  const opportunities: Omit<AuthorityOpportunity, "id" | "created_at" | "updated_at">[] = [];
  const domainLower = domain.replace(/^www\./, "").toLowerCase();
  const seen = new Set<string>();

  const addOpp = (opp: Omit<AuthorityOpportunity, "id" | "created_at" | "updated_at">) => {
    const key = `${opp.type}:${opp.target_site}`;
    if (seen.has(key)) return;
    seen.add(key);
    opportunities.push(opp);
  };

  // Measured citation-source gaps from LLM Mentions
  if (hasLLMMentionsCapability() && buyerPrompts.length > 0) {
    for (const prompt of buyerPrompts.slice(0, 15)) {
      for (const platform of ["google", "chat_gpt"] as const) {
        const mentions = await searchLLMMentions(prompt, platform);
        if (!mentions.success || !mentions.data) continue;

        for (const item of mentions.data) {
          for (const source of item.sources) {
            const sourceDomain = source.domain || "";
            if (!sourceDomain) continue;
            const citesBrand =
              sourceDomain.includes(domainLower) ||
              (source.url || "").toLowerCase().includes(domainLower);

            if (citesBrand) continue;

            let citesCompetitor = false;
            for (const comp of competitors) {
              if (sourceDomain.includes(comp.toLowerCase().replace(/\s+/g, ""))) {
                citesCompetitor = true;
              }
            }

            if (citesCompetitor) {
              addOpp({
                project_id: projectId,
                type: "listicle",
                target_site: sourceDomain,
                target_url: source.url,
                pitch_angle: `AI cites ${sourceDomain} for "${prompt}" but not ${brandName}. Pitch inclusion.`,
                status: "identified",
                estimated_impact: 85,
                difficulty_score: 55,
                competitor_present: true,
                measured: true,
              });
            }
          }
        }

        const topDomains = await getLLMTopDomains(prompt, platform);
        if (topDomains.success && topDomains.data) {
          for (const td of topDomains.data.slice(0, 5)) {
            if (td.domain.includes(domainLower.split(".")[0])) continue;
            addOpp({
              project_id: projectId,
              type: "listicle",
              target_site: td.domain,
              target_url: `https://${td.domain}`,
              pitch_angle: `Top-cited domain (${td.mentions} mentions) for "${prompt}". Target for ${brandName} inclusion.`,
              status: "identified",
              estimated_impact: Math.min(td.mentions * 2, 100),
              difficulty_score: 50,
              competitor_present: competitors.some((c) =>
                td.domain.includes(c.toLowerCase().replace(/\s+/g, ""))
              ),
              measured: true,
            });
          }
        }
      }
    }
  }

  // Real competitor backlink gaps with resolved domains
  const resolvedCompetitors: Array<{ name: string; domain: string }> = [];
  for (const competitor of competitors.slice(0, 3)) {
    const resolved = await resolveCompetitorDomain(competitor, industry);
    resolvedCompetitors.push({
      name: competitor,
      domain: resolved || competitor.toLowerCase().replace(/\s+/g, "") + ".com",
    });
  }

  for (const { name, domain: compDomain } of resolvedCompetitors) {
    const backlinksResult = await getBacklinks(compDomain, 20);

    if (backlinksResult.success && backlinksResult.data) {
      const brandBacklinks = await getBacklinks(domain, 20);
      const brandDomains = new Set((brandBacklinks.data || []).map((b) => b.domain));

      for (const link of backlinksResult.data) {
        if (!brandDomains.has(link.domain)) {
          addOpp({
            project_id: projectId,
            type: "backlink",
            target_site: link.domain,
            target_url: link.url,
            pitch_angle: `Competitor ${name} (${compDomain}) has a backlink here. Pitch ${brandName} as an alternative.`,
            status: "identified",
            domain_authority: link.rank,
            estimated_impact: Math.min(link.rank, 100),
            difficulty_score: link.rank > 50 ? 70 : 40,
            competitor_present: true,
            measured: true,
          });
        }
      }
    }
  }

  // Reddit/Quora monitoring suggestions (human-review queue)
  for (const prompt of buyerPrompts.slice(0, 5)) {
    addOpp({
      project_id: projectId,
      type: "reddit_mention",
      target_site: "reddit.com",
      target_url: `https://www.reddit.com/search/?q=${encodeURIComponent(prompt)}`,
      pitch_angle: `Educational answer opportunity for: "${prompt}". Draft for human review before posting.`,
      status: "identified",
      estimated_impact: 70,
      difficulty_score: 60,
      competitor_present: false,
      measured: false,
    });
    addOpp({
      project_id: projectId,
      type: "quora_mention",
      target_site: "quora.com",
      target_url: `https://www.quora.com/search?q=${encodeURIComponent(prompt)}`,
      pitch_angle: `Quora answer opportunity for: "${prompt}". Draft for human review.`,
      status: "identified",
      estimated_impact: 65,
      difficulty_score: 55,
      competitor_present: false,
      measured: false,
    });
  }

  // AI supplement for directories/podcasts when measured data is thin
  if (opportunities.length < 10) {
    const aiResult = await generateStructured(
      `You are an authority building strategist. Identify high-value opportunities for a brand.`,
      `Find authority opportunities for:
Brand: ${brandName}
Domain: ${domain}
Industry: ${industry}
Competitors: ${competitors.join(", ")}

Find 10 opportunities: directories, podcasts, journalist pitches, guest posts.`,
      OpportunitySchema
    );

    if (aiResult.success && aiResult.data) {
      for (const opp of aiResult.data.opportunities) {
        addOpp({
          project_id: projectId,
          type: opp.type as AuthorityType,
          target_site: opp.target_site,
          target_url: opp.target_url,
          pitch_angle: opp.pitch_angle,
          status: "identified",
          estimated_impact: opp.estimated_impact,
          difficulty_score: opp.difficulty_score,
          competitor_present: opp.competitor_present,
          measured: false,
        });
      }
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
    `You are a professional outreach specialist. Write concise, personalized outreach emails.`,
    `Write outreach for:
Brand: ${brandName}
Target: ${opportunity.target_site}
Type: ${opportunity.type}
Pitch: ${opportunity.pitch_angle}
Measured opportunity: ${opportunity.measured ? "yes" : "no"}`,
    EmailSchema
  );

  if (result.success && result.data) {
    return {
      email: `Subject: ${result.data.subject}\n\n${result.data.email}`,
      followUp: result.data.follow_up,
    };
  }

  return {
    email: `Subject: Partnership opportunity with ${brandName}\n\nHi,\n\n${opportunity.pitch_angle}\n\nBest regards`,
    followUp: `Following up on my email about ${brandName}.`,
  };
}

export async function sendOutreachEmail(
  to: string,
  subject: string,
  body: string
): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "outreach@presenceos.app";
  if (!apiKey) return { success: false, error: "Resend not configured" };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text: body }),
    });
    return { success: response.ok };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Send failed" };
  }
}
