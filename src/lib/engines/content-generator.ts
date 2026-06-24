import { generateWithAI, generateStructured } from "@/lib/providers/ai-gateway";
import { z } from "zod";
import type { ContentAssetType, ContentStatus, BrandProfile } from "@/types/database";

const ContentSchema = z.object({
  title: z.string(),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function generateContent(
  type: ContentAssetType,
  brand: Partial<BrandProfile>,
  topic: string,
  additionalContext?: string
): Promise<{ title: string; content: string; metadata?: Record<string, unknown> }> {
  const brandContext = `
Brand: ${brand.brand_name}
Voice: ${brand.brand_voice || "Professional"}
Values: ${(brand.brand_values || []).join(", ")}
Products/Services: ${(brand.products_services || []).map((p) => p.name).join(", ")}
Target Audience: ${(brand.target_audiences || []).join(", ")}
Author Persona: ${brand.author_persona || "Industry expert"}
Banned Words: ${(brand.banned_words || []).join(", ")}
`;

  const prompts: Record<ContentAssetType, { system: string; user: string }> = {
    service_page: {
      system: "You are an SEO/AEO content writer. Create comprehensive, answer-ready service pages optimized for both search engines and AI citation.",
      user: `${brandContext}\n\nCreate a service page about: ${topic}\n\nInclude: H1, overview, benefits, process, FAQ section, and CTA. 800-1200 words. Use clear headings. Make it citable by AI.`,
    },
    location_page: {
      system: "You are a local SEO content writer. Create location-specific pages optimized for local search and AI answers.",
      user: `${brandContext}\n\nCreate a location page for: ${topic}\n\nInclude: local expertise, service area, local proof points, FAQ, and CTA.`,
    },
    comparison_page: {
      system: "You are a comparison content writer. Create fair, factual comparison pages that help buyers decide.",
      user: `${brandContext}\n\nCreate a comparison page: ${topic}\n\nInclude: feature comparison table, pros/cons, pricing comparison, verdict, and CTA.`,
    },
    best_of_page: {
      system: "You are a listicle/best-of content writer. Create authoritative best-of pages that rank and get cited.",
      user: `${brandContext}\n\nCreate a best-of page: ${topic}\n\nInclude: ranked list with descriptions, criteria, FAQ, and CTA. Position the brand naturally.`,
    },
    faq_page: {
      system: "You are an FAQ content writer. Create comprehensive FAQ pages with schema-ready Q&A format.",
      user: `${brandContext}\n\nCreate FAQ page for: ${topic}\n\nInclude 10-15 Q&A pairs. Each answer should be 2-4 sentences, factual, and citable.`,
    },
    blog_brief: {
      system: "You are a content strategist. Create detailed blog briefs for writers.",
      user: `${brandContext}\n\nCreate a blog brief for: ${topic}\n\nInclude: title options, outline, target keywords, internal link suggestions, and CTA.`,
    },
    blog_post: {
      system: "You are an SEO/AEO blog writer. Create research-backed, answer-ready blog content.",
      user: `${brandContext}\n\nWrite a blog post about: ${topic}\n\n1000-1500 words. Include FAQ section. Optimize for AI citation.`,
    },
    case_study: {
      system: "You are a case study writer. Create compelling case studies with measurable results.",
      user: `${brandContext}\n\nCreate a case study template for: ${topic}\n\nInclude: challenge, solution, results (with placeholder metrics), and testimonial structure.`,
    },
    youtube_script: {
      system: "You are a YouTube scriptwriter. Create engaging educational video scripts.",
      user: `${brandContext}\n\nWrite a YouTube script for: ${topic}\n\n5-8 minute video. Include hook, sections, B-roll suggestions, and CTA.`,
    },
    shorts_script: {
      system: "You are a short-form video scriptwriter.",
      user: `${brandContext}\n\nWrite a 60-second Shorts/Reels script for: ${topic}\n\nHook in first 3 seconds. Clear value. CTA at end.`,
    },
    linkedin_post: {
      system: "You are a LinkedIn content writer. Create professional, engaging posts.",
      user: `${brandContext}\n\nWrite a LinkedIn post about: ${topic}\n\nProfessional tone. Include hook, value, and CTA. Under 300 words.`,
    },
    x_thread: {
      system: "You are an X/Twitter thread writer.",
      user: `${brandContext}\n\nWrite a 5-tweet thread about: ${topic}\n\nNumber each tweet. Hook in tweet 1. CTA in last tweet.`,
    },
    reddit_draft: {
      system: "You are a community content writer. Write educational, non-promotional Reddit posts that provide genuine value. Never be salesy.",
      user: `${brandContext}\n\nWrite an educational Reddit post about: ${topic}\n\nBe helpful, not promotional. Share genuine expertise. No direct brand promotion.`,
    },
    quora_draft: {
      system: "You are a Quora answer writer. Write thorough, authoritative answers.",
      user: `${brandContext}\n\nWrite a Quora answer for: ${topic}\n\nComprehensive, factual, helpful. Subtle expertise demonstration.`,
    },
    newsletter: {
      system: "You are an email newsletter writer.",
      user: `${brandContext}\n\nWrite a newsletter about: ${topic}\n\nSubject line, preview text, body with sections, and CTA.`,
    },
    podcast_script: {
      system: "You are a podcast scriptwriter. Create 2-speaker conversational scripts.",
      user: `${brandContext}\n\nWrite a podcast episode script about: ${topic}\n\n2 speakers (host + expert). 15-20 minutes. Include show notes.`,
    },
    gbp_post: {
      system: "You are a Google Business Profile post writer.",
      user: `${brandContext}\n\nWrite a GBP post about: ${topic}\n\nShort, engaging, with CTA button text. Under 1500 characters.`,
    },
    directory_description: {
      system: "You are a directory listing writer.",
      user: `${brandContext}\n\nWrite a directory listing description for: ${topic}\n\nConcise, keyword-rich, professional. 150-300 words.`,
    },
  };

  const prompt = prompts[type] || prompts.blog_post;
  const fullUser = additionalContext
    ? `${prompt.user}\n\nAdditional context: ${additionalContext}`
    : prompt.user;

  const result = await generateStructured(
    prompt.system,
    fullUser,
    ContentSchema
  );

  if (result.success && result.data) {
    return result.data;
  }

  const fallback = await generateWithAI(prompt.system, fullUser, "quality");
  return {
    title: topic,
    content: fallback.data || "Content generation failed. Please try again.",
  };
}

export const CONTENT_STATUSES: ContentStatus[] = [
  "drafted", "approved", "published", "indexed", "getting_traffic", "needs_refresh",
];

export const ANTI_SPAM_RULES = [
  "Never generate content primarily to manipulate rankings",
  "Create fewer, stronger assets and repurpose them",
  "All community content must be educational, not promotional",
  "Human review required before publishing",
  "Maximum 4 blog posts per week per project",
  "No duplicate or near-duplicate content across platforms",
];
