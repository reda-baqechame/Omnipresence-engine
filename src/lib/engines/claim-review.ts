import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateStructured } from "@/lib/providers/ai-gateway";
import { scrapePage } from "@/lib/providers/firecrawl";
import { scrapePageDirect } from "@/lib/crawl/page-scrape";

/**
 * False-claim / hallucination review (Master Plan v4 feature 7).
 *
 * Reviews the MEASURED answers already captured as receipts and flags factual
 * statements about the brand that the brand's own site contradicts or cannot
 * support. Honest labeling is the whole product:
 *  - "contradicted" — the answer states something the reference facts dispute
 *  - "unsupported"  — a specific factual claim we found no basis for
 *  - "supported"    — checked and consistent (kept for transparency)
 * We never assert an engine "hallucinated"; we show the quote, the receipt,
 * and why it was flagged, and let the human decide.
 */

export interface ReviewedClaim {
  claim: string;
  quote: string;
  engine: string;
  surface: string | null;
  prompt: string;
  verdict: "contradicted" | "unsupported" | "supported";
  explanation: string;
  /** ai_capture_evidence id — links to /verify/{receipt_id}. */
  receipt_id: string;
}

export interface ClaimReviewResult {
  status: "completed" | "no_answers" | "failed";
  claims: ReviewedClaim[];
  answersReviewed: number;
  flaggedCount: number;
  reason?: string;
}

const ClaimExtractionSchema = z.object({
  claims: z
    .array(
      z.object({
        claim: z.string().describe("The factual statement about the brand, paraphrased concisely"),
        quote: z.string().describe("Short verbatim excerpt from the answer containing the claim"),
        verdict: z
          .enum(["contradicted", "unsupported", "supported"])
          .describe(
            "contradicted = reference facts dispute it; unsupported = specific factual claim with no basis in the reference facts; supported = consistent with the reference facts"
          ),
        explanation: z.string().describe("One sentence: why this verdict, citing the reference fact when contradicted"),
      })
    )
    .max(10),
});

async function fetchReferenceFacts(domain: string): Promise<string> {
  const url = domain.startsWith("http") ? domain : `https://${domain}`;
  const fc = await scrapePage(url).catch(() => null);
  if (fc?.success && fc.data) {
    return [
      `Title: ${fc.data.title || ""}`,
      `Description: ${fc.data.metaDescription || ""}`,
      `Headings: ${fc.data.headings.map((h) => h.text).join(" | ")}`,
    ].join("\n");
  }
  const direct = await scrapePageDirect(url).catch(() => null);
  if (direct) {
    return [
      `Title: ${direct.title || ""}`,
      `Description: ${direct.metaDescription || ""}`,
      `Headings: ${direct.headings.map((h) => h.text).join(" | ")}`,
    ].join("\n");
  }
  return "";
}

/** Max receipts reviewed per run — bounds LLM cost per click. */
const MAX_ANSWERS_PER_REVIEW = 12;

export async function runClaimReview(
  supabase: SupabaseClient,
  project: { id: string; organization_id: string; brand_name: string; domain: string }
): Promise<ClaimReviewResult> {
  // Only review receipts: measured answers with verifiable provenance. An
  // answer that was never captured as evidence can't be reviewed honestly.
  const { data: receipts } = await supabase
    .from("ai_capture_evidence")
    .select("id, engine, surface, prompt, raw_answer, measurement_mode, created_at")
    .eq("project_id", project.id)
    .not("raw_answer", "is", null)
    .order("created_at", { ascending: false })
    .limit(MAX_ANSWERS_PER_REVIEW * 2);

  const candidates = (receipts || [])
    .filter((r) => typeof r.raw_answer === "string" && r.raw_answer.length > 80)
    // Review answers that actually talk about the brand.
    .filter((r) => r.raw_answer.toLowerCase().includes(project.brand_name.toLowerCase()))
    .slice(0, MAX_ANSWERS_PER_REVIEW);

  if (candidates.length === 0) {
    return {
      status: "no_answers",
      claims: [],
      answersReviewed: 0,
      flaggedCount: 0,
      reason:
        "No captured answers mention the brand yet. Run a scan first — claims are reviewed against receipts, never against synthetic answers.",
    };
  }

  const referenceFacts = await fetchReferenceFacts(project.domain);
  const systemPrompt = `You are a fact-checker for the brand "${project.brand_name}" (${project.domain}). You review what an AI engine said about this brand and flag factual claims. Reference facts from the brand's own site:\n${referenceFacts || "(homepage unavailable — mark specific factual claims as unsupported rather than contradicted)"}\n\nRules: only extract SPECIFIC factual claims about ${project.brand_name} (pricing, features, locations, leadership, dates, integrations, certifications). Ignore opinions, rankings, and claims about other companies. If the answer makes no specific factual claims about the brand, return an empty list. Never invent claims.`;

  // Review answers in parallel — a serverless request can't afford 12
  // sequential LLM round-trips. Order of the output stays deterministic
  // (candidates order) because we collect per-candidate then flatten.
  const perAnswer = await Promise.all(
    candidates.map(async (r) => {
      const res = await generateStructured(
        systemPrompt,
        `AI engine answer (from ${r.engine}) to the prompt "${(r.prompt || "").slice(0, 300)}":\n\n${r.raw_answer.slice(0, 6000)}`,
        ClaimExtractionSchema
      ).catch(() => null);
      if (!res?.success || !res.data) return [] as ReviewedClaim[];
      return res.data.claims.map((c) => ({
        claim: c.claim.slice(0, 500),
        quote: c.quote.slice(0, 500),
        engine: r.engine,
        surface: r.surface || null,
        prompt: (r.prompt || "").slice(0, 300),
        verdict: c.verdict,
        explanation: c.explanation.slice(0, 500),
        receipt_id: r.id,
      }));
    })
  );
  const claims: ReviewedClaim[] = perAnswer.flat();

  const flagged = claims.filter((c) => c.verdict !== "supported");
  return {
    status: "completed",
    claims,
    answersReviewed: candidates.length,
    flaggedCount: flagged.length,
  };
}

/** Persist a review run; returns the stored row id (null on failure). */
export async function saveClaimReview(
  supabase: SupabaseClient,
  project: { id: string; organization_id: string },
  result: ClaimReviewResult
): Promise<string | null> {
  const { data, error } = await supabase
    .from("claim_reviews")
    .insert({
      project_id: project.id,
      organization_id: project.organization_id,
      status: result.status,
      claims: result.claims,
      answers_reviewed: result.answersReviewed,
      flagged_count: result.flaggedCount,
    })
    .select("id")
    .single();
  if (error) return null;
  return data?.id ?? null;
}
