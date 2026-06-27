import { z } from "zod";
import { generateStructured } from "@/lib/providers/ai-gateway";

/**
 * Earned-media / press-release workflow (Phase 10).
 *
 * Scoped deliberately to BRANDED and LOW-COMPETITION prompts (e.g. "is <brand>
 * legit", "<brand> alternatives", niche category questions) where a single
 * well-placed, genuinely newsworthy asset can move AI citations. This is NOT a
 * tactic for competitive head terms - we flag that explicitly so it is never
 * mis-sold as a ranking guarantee.
 */

const EarnedMediaSchema = z.object({
  newsworthy: z
    .boolean()
    .describe("Whether there is a genuinely newsworthy, non-promotional angle"),
  scope_warning: z
    .string()
    .describe("One line stating this works for branded/low-competition prompts, not head terms"),
  headline: z.string(),
  angle: z.string().describe("The news hook / why a journalist or outlet would care"),
  press_release: z.string().describe("A short, factual press release draft (150-250 words)"),
  target_outlets: z
    .array(z.object({ name: z.string(), type: z.string(), why: z.string() }))
    .describe("3-6 realistic outlets/communities to pitch"),
  supporting_assets: z
    .array(z.string())
    .describe("Data points, quotes, or assets needed to make it credible"),
  pitch_email: z.string().describe("A concise outreach email (<120 words)"),
});

export type EarnedMediaPlan = z.infer<typeof EarnedMediaSchema>;

export async function generateEarnedMediaPlan(input: {
  brand: string;
  domain: string;
  prompt: string;
  industry?: string;
  differentiators?: string[];
}): Promise<{ available: boolean; plan?: EarnedMediaPlan; reason?: string }> {
  const res = await generateStructured(
    "You are a digital-PR strategist. You only propose genuinely newsworthy, factual earned-media angles - never fabricated claims or spam. You are honest about when an angle is weak.",
    `Brand: ${input.brand} (${input.domain})
Industry: ${input.industry || "n/a"}
Differentiators: ${(input.differentiators || []).join(", ") || "n/a"}
Target AI/search prompt to influence: "${input.prompt}"

This is for a BRANDED or LOW-COMPETITION prompt where earned media can realistically move AI citations. Produce a scoped earned-media plan. If there is no honest newsworthy angle, set newsworthy=false and keep the press release minimal.`,
    EarnedMediaSchema
  );

  if (!res.success || !res.data) {
    return { available: false, reason: res.error || "AI generation unavailable." };
  }
  return { available: true, plan: res.data };
}
