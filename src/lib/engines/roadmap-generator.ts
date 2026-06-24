import { generateStructured } from "@/lib/providers/ai-gateway";
import { z } from "zod";
import type { RoadmapItem, TechnicalFinding, CoverageItem, AuthorityOpportunity } from "@/types/database";

const RoadmapSchema = z.object({
  items: z.array(
    z.object({
      week: z.number(),
      title: z.string(),
      description: z.string(),
      impact: z.enum(["critical", "high", "medium", "low"]),
      category: z.string(),
      estimated_hours: z.number().optional(),
    })
  ),
});

export async function generateRoadmap(
  projectId: string,
  brandName: string,
  domain: string,
  industry: string,
  location: string,
  technicalFindings: TechnicalFinding[],
  coverageGaps: CoverageItem[],
  authorityOpportunities: AuthorityOpportunity[],
  durationDays = 90
): Promise<{ project_id: string; duration_days: number; items: RoadmapItem[] }> {
  const criticalFindings = technicalFindings.filter((f) => f.severity === "critical" || f.severity === "high");
  const missingCoverage = coverageGaps.filter((c) => !c.is_present);
  const topOpportunities = authorityOpportunities
    .sort((a, b) => (b.estimated_impact || 0) - (a.estimated_impact || 0))
    .slice(0, 10);

  const context = `
Brand: ${brandName} (${domain})
Industry: ${industry}
Location: ${location}
Duration: ${durationDays} days

Critical Technical Issues (${criticalFindings.length}):
${criticalFindings.slice(0, 5).map((f) => `- [${f.severity}] ${f.title}: ${f.fix_recommendation}`).join("\n")}

Missing Platform Coverage (${missingCoverage.length}):
${missingCoverage.slice(0, 8).map((c) => `- ${c.platform_name} (${c.surface})`).join("\n")}

Top Authority Opportunities (${topOpportunities.length}):
${topOpportunities.slice(0, 5).map((o) => `- ${o.type}: ${o.target_site} (impact: ${o.estimated_impact})`).join("\n")}
`;

  const result = await generateStructured(
    `You are an organic growth strategist. Create a detailed, week-by-week execution roadmap that will maximize a brand's visibility across search engines, AI platforms, social media, directories, and authority sites. Prioritize by revenue impact.`,
    `Create a ${durationDays}-day execution roadmap:

${context}

Structure as weekly tasks covering:
Week 1-2: Technical fixes (robots.txt, schema, crawlability, AI bot access)
Week 3-4: Content creation (service pages, comparison pages, FAQs, best-of pages)
Week 5-6: Platform presence (directories, social profiles, review sites, GBP)
Week 7-8: Authority building (backlinks, listicles, podcasts, outreach)
Week 9-12: Content distribution + repurposing (social, YouTube, community)
Week 13: Re-scan and double down on what's working

Each item needs: week number, title, description, impact level, category, estimated hours.
Aim for 30-40 actionable items total.`,
    RoadmapSchema
  );

  if (result.success && result.data) {
    return {
      project_id: projectId,
      duration_days: durationDays,
      items: result.data.items,
    };
  }

  return {
    project_id: projectId,
    duration_days: durationDays,
    items: generateFallbackRoadmap(brandName, industry, location, criticalFindings, missingCoverage),
  };
}

function generateFallbackRoadmap(
  brandName: string,
  industry: string,
  location: string,
  criticalFindings: TechnicalFinding[],
  missingCoverage: CoverageItem[]
): RoadmapItem[] {
  const items: RoadmapItem[] = [];
  let week = 1;

  for (const finding of criticalFindings.slice(0, 3)) {
    items.push({
      week,
      title: `Fix: ${finding.title}`,
      description: finding.fix_recommendation || finding.description,
      impact: "critical",
      category: finding.category,
      estimated_hours: 2,
    });
    week = week <= 2 ? week : 2;
  }

  items.push(
    { week: 1, title: "Allow AI crawlers in robots.txt", description: "Ensure OAI-SearchBot, PerplexityBot, and Google-Extended can access your site.", impact: "critical", category: "technical", estimated_hours: 1 },
    { week: 1, title: "Add Organization schema markup", description: "Deploy JSON-LD Organization schema on homepage.", impact: "high", category: "schema", estimated_hours: 2 },
    { week: 2, title: `Create "Best ${industry} in ${location}" page`, description: "Build a comprehensive best-of page targeting high-intent local queries.", impact: "high", category: "content", estimated_hours: 4 },
    { week: 2, title: "Create 5 FAQ blocks with FAQ schema", description: "Add FAQ sections to key service pages with FAQPage schema.", impact: "high", category: "content", estimated_hours: 3 },
    { week: 3, title: "Create 3 comparison pages", description: `Build ${brandName} vs competitor comparison pages.`, impact: "high", category: "content", estimated_hours: 6 },
    { week: 3, title: "Optimize Google Business Profile", description: "Complete GBP with photos, services, posts, and Q&A.", impact: "high", category: "local", estimated_hours: 3 },
    { week: 4, title: "Submit to 10 industry directories", description: "Claim and optimize profiles on relevant directories.", impact: "medium", category: "directory", estimated_hours: 4 },
  );

  for (const gap of missingCoverage.slice(0, 5)) {
    items.push({
      week: 4,
      title: `Create ${gap.platform_name} profile`,
      description: `Set up and optimize ${brandName}'s presence on ${gap.platform_name}.`,
      impact: "medium",
      category: gap.surface,
      estimated_hours: 1,
    });
  }

  items.push(
    { week: 5, title: "Generate 20 social media posts", description: "Repurpose top content into LinkedIn, X, and Facebook posts.", impact: "medium", category: "social", estimated_hours: 4 },
    { week: 6, title: "Pitch 10 listicle opportunities", description: "Reach out to industry listicle authors for inclusion.", impact: "high", category: "authority", estimated_hours: 6 },
    { week: 7, title: "Create 3 YouTube video scripts", description: "Write scripts for educational videos targeting buyer prompts.", impact: "medium", category: "content", estimated_hours: 4 },
    { week: 8, title: "Run AI visibility re-scan", description: "Re-run visibility scan to measure progress.", impact: "high", category: "tracking", estimated_hours: 1 },
    { week: 9, title: "Double down on winning surfaces", description: "Analyze which platforms are driving results and increase effort there.", impact: "critical", category: "optimization", estimated_hours: 4 },
  );

  return items;
}
