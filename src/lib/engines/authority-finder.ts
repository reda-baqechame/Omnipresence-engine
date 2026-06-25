import {
  getBacklinks,
  resolveCompetitorDomain,
} from "@/lib/providers/dataforseo";
import { getBacklinksFree } from "@/lib/providers/backlinks-free";
import { resolveCompetitorDomainFree } from "@/lib/providers/competitor-resolve";
import { hasLLMMentionsCapability, hasCitationTrackingCapability } from "@/lib/config/capabilities";
import {
  collectLiveCitationSources,
  collectDataForSEOCitationSources,
  getStoredCitationSources,
  aggregateTopCitedDomains,
  getTopCitedDomainsFromStored,
  getDataForSEOTopDomains,
} from "@/lib/engines/citation-intelligence";
import { generateStructured } from "@/lib/providers/ai-gateway";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
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
  const brandToken = domainLower.split(".")[0];
  const seen = new Set<string>();

  const addOpp = (opp: Omit<AuthorityOpportunity, "id" | "created_at" | "updated_at">) => {
    const key = `${opp.type}:${opp.target_site}`;
    if (seen.has(key)) return;
    seen.add(key);
    opportunities.push(opp);
  };

  // Citation-source gaps: stored scan data + live DIY stack (Perplexity + SERP)
  if (hasCitationTrackingCapability() && buyerPrompts.length > 0) {
    const storedSources = await getStoredCitationSources(projectId);
    const allLiveSources = [...storedSources];

    for (const prompt of buyerPrompts.slice(0, 15)) {
      const liveSources = await collectLiveCitationSources(
        prompt,
        brandName,
        domain,
        competitors
      );
      allLiveSources.push(...liveSources);

      if (hasLLMMentionsCapability()) {
        for (const platform of ["google", "chat_gpt"] as const) {
          allLiveSources.push(...await collectDataForSEOCitationSources(prompt, platform));
        }
      }

      for (const source of liveSources) {
        const sourceDomain = source.domain;
        if (!sourceDomain) continue;

        const citesBrand =
          sourceDomain.includes(domainLower) ||
          sourceDomain.includes(brandToken) ||
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
            pitch_angle: `AI/SERP cites ${sourceDomain} for "${prompt}" but not ${brandName}. Pitch inclusion.`,
            status: "identified",
            estimated_impact: 85,
            difficulty_score: 55,
            competitor_present: true,
            measured: true,
          });
        }
      }

      const topFromLive = aggregateTopCitedDomains(
        allLiveSources.filter((s) => s.promptText === prompt),
        5
      );
      const topFromStored = getTopCitedDomainsFromStored(storedSources, prompt, 5);

      const topDomainsMap = new Map<string, number>();
      for (const td of [...topFromLive, ...topFromStored]) {
        topDomainsMap.set(td.domain, Math.max(topDomainsMap.get(td.domain) || 0, td.mentions));
      }

      if (hasLLMMentionsCapability()) {
        for (const platform of ["google", "chat_gpt"] as const) {
          const dfsTop = await getDataForSEOTopDomains(prompt, platform);
          for (const td of dfsTop.slice(0, 5)) {
            topDomainsMap.set(td.domain, Math.max(topDomainsMap.get(td.domain) || 0, td.mentions));
          }
        }
      }

      for (const [tdDomain, mentions] of topDomainsMap.entries()) {
        if (tdDomain.includes(brandToken)) continue;
        addOpp({
          project_id: projectId,
          type: "listicle",
          target_site: tdDomain,
          target_url: `https://${tdDomain}`,
          pitch_angle: `Top-cited domain (${mentions} mentions) for "${prompt}". Target for ${brandName} inclusion.`,
          status: "identified",
          estimated_impact: Math.min(mentions * 2, 100),
          difficulty_score: 50,
          competitor_present: competitors.some((c) =>
            tdDomain.includes(c.toLowerCase().replace(/\s+/g, ""))
          ),
          measured: true,
        });
      }
    }
  }

  // Competitor backlink gaps via free link: SERP (DataForSEO optional boost)
  const resolvedCompetitors: Array<{ name: string; domain: string }> = [];
  for (const competitor of competitors.slice(0, 3)) {
    const resolved =
      (await resolveCompetitorDomainFree(competitor, industry)) ||
      (hasLLMMentionsCapability()
        ? await resolveCompetitorDomain(competitor, industry)
        : null);

    resolvedCompetitors.push({
      name: competitor,
      domain: resolved || competitor.toLowerCase().replace(/\s+/g, "") + ".com",
    });
  }

  for (const { name, domain: compDomain } of resolvedCompetitors) {
    let backlinksResult = await getBacklinksFree(compDomain, 20);
    if ((!backlinksResult.success || !backlinksResult.data?.length) && hasLLMMentionsCapability()) {
      backlinksResult = await getBacklinks(compDomain, 20);
    }

    if (backlinksResult.success && backlinksResult.data) {
      let brandBacklinks = await getBacklinksFree(domain, 20);
      if ((!brandBacklinks.success || !brandBacklinks.data?.length) && hasLLMMentionsCapability()) {
        brandBacklinks = await getBacklinks(domain, 20);
      }
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

  // HARO / journalist source-request finder (real, via SERP)
  for (const opp of await findJournalistOpportunities(projectId, brandName, industry)) {
    addOpp(opp);
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

/**
 * HARO / journalist source-request finder. Uses real SERP queries to surface
 * live "looking for sources" / #journorequest / Connectively / Qwoted / Featured
 * opportunities a brand can pitch for earned media (which AI engines cite).
 */
export async function findJournalistOpportunities(
  projectId: string,
  brandName: string,
  industry: string
): Promise<Omit<AuthorityOpportunity, "id" | "created_at" | "updated_at">[]> {
  const out: Omit<AuthorityOpportunity, "id" | "created_at" | "updated_at">[] = [];
  const queries = [
    `${industry} "looking for sources"`,
    `${industry} "request for sources" journalist`,
    `#journorequest ${industry}`,
    `${industry} expert quote request (connectively.us OR qwoted.com OR featured.com OR sourcebottle.com)`,
  ];

  const seen = new Set<string>();
  for (const q of queries) {
    const res = await searchGoogleOrganicRouter(q, "United States", "", []);
    if (!res.success || !res.data) continue;
    for (const r of res.data.organicResults.slice(0, 5)) {
      let host = "";
      try {
        host = new URL(r.url).hostname.replace(/^www\./, "");
      } catch {
        continue;
      }
      if (!host || seen.has(host)) continue;
      seen.add(host);
      out.push({
        project_id: projectId,
        type: "journalist",
        target_site: host,
        target_url: r.url,
        pitch_angle: `Source/quote request matching ${industry}: "${r.title}". Pitch ${brandName} as an expert source with a concise, data-backed quote.`,
        status: "identified",
        estimated_impact: 80,
        difficulty_score: 45,
        competitor_present: false,
        measured: true,
      });
      if (out.length >= 12) return out;
    }
  }
  return out;
}

export interface OutreachSequenceStep {
  touch: number;
  day_offset: number;
  channel: "email";
  subject: string;
  body: string;
  status: "scheduled";
}

/**
 * Multi-touch outreach CRM sequence: initial pitch + spaced follow-ups
 * (day 0 / 3 / 7), generated for a specific opportunity. Ready to persist and
 * schedule via the existing Resend sender.
 */
export async function buildOutreachSequence(
  brandName: string,
  opportunity: AuthorityOpportunity,
  recipientName = "there"
): Promise<OutreachSequenceStep[]> {
  const { generateStructured: gen } = await import("@/lib/providers/ai-gateway");
  const SeqSchema = z.object({
    initial_subject: z.string(),
    initial_body: z.string(),
    followup_1_subject: z.string(),
    followup_1_body: z.string(),
    followup_2_subject: z.string(),
    followup_2_body: z.string(),
  });

  const result = await gen(
    `You are an outreach CRM strategist. Write a 3-touch outreach sequence (initial + 2 polite, value-adding follow-ups). Keep each email under 120 words, personalized, and non-spammy.`,
    `Brand: ${brandName}
Recipient: ${recipientName}
Target: ${opportunity.target_site}
Opportunity type: ${opportunity.type}
Pitch angle: ${opportunity.pitch_angle}`,
    SeqSchema
  );

  if (result.success && result.data) {
    const d = result.data;
    return [
      { touch: 1, day_offset: 0, channel: "email", subject: d.initial_subject, body: d.initial_body, status: "scheduled" },
      { touch: 2, day_offset: 3, channel: "email", subject: d.followup_1_subject, body: d.followup_1_body, status: "scheduled" },
      { touch: 3, day_offset: 7, channel: "email", subject: d.followup_2_subject, body: d.followup_2_body, status: "scheduled" },
    ];
  }

  // Deterministic fallback sequence.
  return [
    {
      touch: 1,
      day_offset: 0,
      channel: "email",
      subject: `Quick idea for ${opportunity.target_site}`,
      body: `Hi ${recipientName},\n\n${opportunity.pitch_angle}\n\nWould this be a fit? Happy to send specifics.\n\n— ${brandName}`,
      status: "scheduled",
    },
    {
      touch: 2,
      day_offset: 3,
      channel: "email",
      subject: `Following up — ${brandName}`,
      body: `Hi ${recipientName},\n\nJust floating this back to the top of your inbox. I can make it turnkey on our end.\n\n— ${brandName}`,
      status: "scheduled",
    },
    {
      touch: 3,
      day_offset: 7,
      channel: "email",
      subject: `Last note from ${brandName}`,
      body: `Hi ${recipientName},\n\nI'll stop here so I'm not a bother — if the timing's better later, just reply and I'll pick it up.\n\n— ${brandName}`,
      status: "scheduled",
    },
  ];
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
